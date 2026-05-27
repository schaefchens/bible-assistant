import type { Translation } from './bibleApi';

export type TranslationInfo = {
  code: Translation;
  name: string;
  year: number;
  language: 'en' | 'de';
  blurb: { en: string; de: string };
};

export const TRANSLATIONS: TranslationInfo[] = [
  {
    code: 'ESV',
    name: 'English Standard Version',
    year: 2001,
    language: 'en',
    blurb: {
      en: 'Modern word-for-word translation',
      de: 'Moderne wortgetreue Übersetzung',
    },
  },
  {
    code: 'KJV',
    name: 'King James Version',
    year: 1611,
    language: 'en',
    blurb: {
      en: 'Classic Authorized Version',
      de: 'Klassische autorisierte Fassung',
    },
  },
  {
    code: 'NKJV',
    name: 'New King James Version',
    year: 1982,
    language: 'en',
    blurb: {
      en: 'King James modernized',
      de: 'King James in modernem Englisch',
    },
  },
  {
    code: 'S00',
    name: 'Schlachter 2000',
    year: 2000,
    language: 'de',
    blurb: {
      en: 'Conservative German, word-for-word',
      de: 'Konservativ, wortgetreu',
    },
  },
  {
    code: 'LUT',
    name: 'Luther 1912',
    year: 1912,
    language: 'de',
    blurb: {
      en: 'Luther translation, 1912 revision',
      de: 'Luther-Übersetzung, Revision 1912',
    },
  },
  {
    code: 'HFA',
    name: 'Hoffnung für Alle',
    year: 1996,
    language: 'de',
    blurb: {
      en: 'Modern everyday German, thought-for-thought',
      de: 'Modern, sinngemäß, gut verständlich',
    },
  },
  {
    code: 'S51',
    name: 'Schlachter 1951',
    year: 1951,
    language: 'de',
    blurb: {
      en: 'With Strong’s numbers for word study',
      de: 'Mit Strong-Nummern für das Wortstudium',
    },
  },
  {
    code: 'ELB',
    name: 'Elberfelder 1905',
    year: 1905,
    language: 'de',
    blurb: {
      en: 'Literal German, with Strong’s numbers',
      de: 'Wortgetreu, mit Strong-Nummern',
    },
  },
];

const byCode = new Map(TRANSLATIONS.map((t) => [t.code, t]));

export function getTranslationInfo(code: Translation): TranslationInfo {
  return byCode.get(code) ?? TRANSLATIONS[0];
}
