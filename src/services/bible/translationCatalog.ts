import type { Translation } from './bibleApi';

export type TranslationInfo = {
  code: Translation;
  name: string;
  year: number;
  language: 'en' | 'de';
  blurb: { en: string; de: string };
  /**
   * Whether anyone may *choose* this translation — the picker, onboarding, the
   * assistant's tools. `false` is a translation the app is not licensed to
   * offer: it is hidden from every choice, and a persisted selection of it
   * falls back to the locale's default (settingsStore `merge`). Content that
   * already names it — a card, a pinned list entry — still reads in it rather
   * than going blank.
   */
  offered: boolean;
  /**
   * The copyright notice listed in Settings › Data & app › Bible texts, as
   * paragraphs of lines. In the translation's own language, not the UI's: it
   * belongs to the text. A line that is a URL renders as a link.
   *
   * Where a rights holder supplied the wording, it is theirs verbatim — S00's
   * is the Genfer Bibelgesellschaft's, and `translationNotices.test.ts` pins it.
   */
  notice: readonly (readonly string[])[];
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
    offered: false,
    notice: [
      [
        'The Holy Bible, English Standard Version® (ESV®)',
        'ESV® Text Edition: 2016. Copyright © 2001 by Crossway, a publishing ministry of Good News Publishers. All rights reserved.',
      ],
    ],
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
    offered: true,
    notice: [
      [
        'King James Version (Authorized Version), 1611',
        'Public domain. Rights in the United Kingdom are vested in the Crown.',
      ],
    ],
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
    offered: false,
    notice: [
      ['New King James Version®', 'Copyright © 1982 by Thomas Nelson. All rights reserved.'],
    ],
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
    offered: true,
    notice: [
      [
        'Bibeltext der Schlachter',
        'Copyright © 2000 Genfer Bibelgesellschaft',
        'Wiedergegeben mit freundlicher Genehmigung. Alle Rechte vorbehalten.',
        'https://www.bibelgesellschaft.com/de',
      ],
      ['Die offizielle Hörbibel ist beim CLV Verlag erhältlich', 'https://clv.de/hoerbibel'],
    ],
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
    offered: true,
    notice: [
      [
        'Lutherbibel 1912, in neuer Rechtschreibung',
        'Gemeinfrei (Public Domain).',
        'Textausgabe: https://www.toledot.info',
      ],
    ],
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
    offered: false,
    notice: [
      [
        'Hoffnung für alle®',
        'Copyright © 1983, 1996, 2002, 2015 by Biblica, Inc.® Alle Rechte vorbehalten.',
      ],
    ],
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
    // Not offered until the Genfer Bibelgesellschaft says whether the 1951
    // revision is still theirs — sources disagree, and its revisers' dates,
    // which would settle it, are not on record.
    offered: false,
    notice: [['Schlachter-Bibel 1951, mit Strong-Nummern', 'Copyright © 1951 Genfer Bibelgesellschaft']],
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
    offered: true,
    notice: [
      [
        'Elberfelder Bibel 1905 (unrevidiert), mit Strong-Nummern',
        'Gemeinfrei (Public Domain).',
        'Textausgabe: https://www.bibelkommentare.de',
      ],
    ],
  },
];

const byCode = new Map(TRANSLATIONS.map((t) => [t.code, t]));

export function getTranslationInfo(code: Translation): TranslationInfo {
  return byCode.get(code) ?? TRANSLATIONS[0];
}

/** The translations anyone may choose, in catalog order. */
export const OFFERED_TRANSLATIONS: readonly TranslationInfo[] = TRANSLATIONS.filter(
  (t) => t.offered,
);

/** Their codes — what the assistant's tool schemas enumerate. */
export const OFFERED_CODES: Translation[] = OFFERED_TRANSLATIONS.map((t) => t.code);

export function isOffered(code: Translation): boolean {
  return byCode.get(code)?.offered === true;
}

/**
 * `code` if it names a translation anyone may choose, else undefined. For a
 * tool argument: the schemas enumerate only {@link OFFERED_CODES}, but an enum
 * does not bind the model, and "read John 3 in ESV" will produce one anyway.
 */
export function asOffered(code: unknown): Translation | undefined {
  return typeof code === 'string' && isOffered(code as Translation)
    ? (code as Translation)
    : undefined;
}

/** "KJV = King James Version (en), S00 = Schlachter 2000 (de), …" — the
 * key the system prompts and `set_translation` give the model. */
export function translationGlossary(): string {
  return OFFERED_TRANSLATIONS.map((t) => `${t.code} = ${t.name} (${t.language})`).join(', ');
}
