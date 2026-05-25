export type BookEntry = {
  id: number;
  nameEn: string;
  nameDe: string;
  abbrevsEn: string[];
  abbrevsDe: string[];
  chapters: number;
};

export const BOOKS: BookEntry[] = [
  { id: 1,  nameEn: 'Genesis',         nameDe: '1. Mose',           abbrevsEn: ['gen', 'ge', 'gn'],            abbrevsDe: ['1mo', '1.mose', '1m', '1mos', 'gen'],   chapters: 50 },
  { id: 2,  nameEn: 'Exodus',          nameDe: '2. Mose',           abbrevsEn: ['exo', 'ex', 'exod'],          abbrevsDe: ['2mo', '2.mose', '2m', '2mos', 'ex'],    chapters: 40 },
  { id: 3,  nameEn: 'Leviticus',       nameDe: '3. Mose',           abbrevsEn: ['lev', 'le', 'lv'],            abbrevsDe: ['3mo', '3.mose', '3m', 'lev'],           chapters: 27 },
  { id: 4,  nameEn: 'Numbers',         nameDe: '4. Mose',           abbrevsEn: ['num', 'nu', 'nm', 'nb'],      abbrevsDe: ['4mo', '4.mose', '4m', 'num'],           chapters: 36 },
  { id: 5,  nameEn: 'Deuteronomy',     nameDe: '5. Mose',           abbrevsEn: ['deut', 'dt', 'de'],           abbrevsDe: ['5mo', '5.mose', '5m', 'dtn'],           chapters: 34 },
  { id: 6,  nameEn: 'Joshua',          nameDe: 'Josua',             abbrevsEn: ['josh', 'jos', 'jsh'],         abbrevsDe: ['jos'],                                   chapters: 24 },
  { id: 7,  nameEn: 'Judges',          nameDe: 'Richter',           abbrevsEn: ['judg', 'jdg', 'jg', 'jdgs'],  abbrevsDe: ['ri', 'rich'],                            chapters: 21 },
  { id: 8,  nameEn: 'Ruth',            nameDe: 'Ruth',              abbrevsEn: ['ruth', 'ru', 'rth'],          abbrevsDe: ['rut', 'ru'],                             chapters: 4 },
  { id: 9,  nameEn: '1 Samuel',        nameDe: '1. Samuel',         abbrevsEn: ['1sam', '1sa', '1s'],          abbrevsDe: ['1sam', '1sa', '1s'],                     chapters: 31 },
  { id: 10, nameEn: '2 Samuel',        nameDe: '2. Samuel',         abbrevsEn: ['2sam', '2sa', '2s'],          abbrevsDe: ['2sam', '2sa', '2s'],                     chapters: 24 },
  { id: 11, nameEn: '1 Kings',         nameDe: '1. Könige',         abbrevsEn: ['1kgs', '1ki', '1k'],          abbrevsDe: ['1kö', '1koe', '1kge', '1koen'],          chapters: 22 },
  { id: 12, nameEn: '2 Kings',         nameDe: '2. Könige',         abbrevsEn: ['2kgs', '2ki', '2k'],          abbrevsDe: ['2kö', '2koe', '2kge', '2koen'],          chapters: 25 },
  { id: 13, nameEn: '1 Chronicles',    nameDe: '1. Chronik',        abbrevsEn: ['1chr', '1ch'],                abbrevsDe: ['1chr', '1ch'],                           chapters: 29 },
  { id: 14, nameEn: '2 Chronicles',    nameDe: '2. Chronik',        abbrevsEn: ['2chr', '2ch'],                abbrevsDe: ['2chr', '2ch'],                           chapters: 36 },
  { id: 15, nameEn: 'Ezra',            nameDe: 'Esra',              abbrevsEn: ['ezra', 'ezr'],                abbrevsDe: ['esr'],                                   chapters: 10 },
  { id: 16, nameEn: 'Nehemiah',        nameDe: 'Nehemia',           abbrevsEn: ['neh', 'ne'],                  abbrevsDe: ['neh'],                                   chapters: 13 },
  { id: 17, nameEn: 'Esther',          nameDe: 'Esther',            abbrevsEn: ['est', 'es', 'esth'],          abbrevsDe: ['est'],                                   chapters: 10 },
  { id: 18, nameEn: 'Job',             nameDe: 'Hiob',              abbrevsEn: ['job', 'jb'],                  abbrevsDe: ['hi', 'hio'],                             chapters: 42 },
  { id: 19, nameEn: 'Psalms',          nameDe: 'Psalmen',           abbrevsEn: ['ps', 'psa', 'pss', 'psalm'],  abbrevsDe: ['ps', 'psa', 'psalm'],                    chapters: 150 },
  { id: 20, nameEn: 'Proverbs',        nameDe: 'Sprüche',           abbrevsEn: ['prov', 'pr', 'pro', 'prv'],   abbrevsDe: ['spr'],                                   chapters: 31 },
  { id: 21, nameEn: 'Ecclesiastes',    nameDe: 'Prediger',          abbrevsEn: ['eccl', 'ecc', 'ec', 'qoh'],   abbrevsDe: ['pred', 'koh'],                           chapters: 12 },
  { id: 22, nameEn: 'Song of Solomon', nameDe: 'Hohelied',          abbrevsEn: ['song', 'sos', 'so', 'ss'],    abbrevsDe: ['hld', 'hl'],                             chapters: 8 },
  { id: 23, nameEn: 'Isaiah',          nameDe: 'Jesaja',            abbrevsEn: ['isa', 'is'],                  abbrevsDe: ['jes'],                                   chapters: 66 },
  { id: 24, nameEn: 'Jeremiah',        nameDe: 'Jeremia',           abbrevsEn: ['jer', 'je', 'jr'],            abbrevsDe: ['jer'],                                   chapters: 52 },
  { id: 25, nameEn: 'Lamentations',    nameDe: 'Klagelieder',       abbrevsEn: ['lam', 'la'],                  abbrevsDe: ['klgl', 'kl'],                            chapters: 5 },
  { id: 26, nameEn: 'Ezekiel',         nameDe: 'Hesekiel',          abbrevsEn: ['ezek', 'eze', 'ezk'],         abbrevsDe: ['hes', 'hes'],                            chapters: 48 },
  { id: 27, nameEn: 'Daniel',          nameDe: 'Daniel',            abbrevsEn: ['dan', 'da', 'dn'],            abbrevsDe: ['dan'],                                   chapters: 12 },
  { id: 28, nameEn: 'Hosea',           nameDe: 'Hosea',             abbrevsEn: ['hos', 'ho'],                  abbrevsDe: ['hos'],                                   chapters: 14 },
  { id: 29, nameEn: 'Joel',            nameDe: 'Joel',              abbrevsEn: ['joel', 'jl'],                 abbrevsDe: ['joel'],                                  chapters: 3 },
  { id: 30, nameEn: 'Amos',            nameDe: 'Amos',              abbrevsEn: ['amos', 'am'],                 abbrevsDe: ['am'],                                    chapters: 9 },
  { id: 31, nameEn: 'Obadiah',         nameDe: 'Obadja',            abbrevsEn: ['obad', 'ob'],                 abbrevsDe: ['ob', 'obd'],                             chapters: 1 },
  { id: 32, nameEn: 'Jonah',           nameDe: 'Jona',              abbrevsEn: ['jonah', 'jon', 'jnh'],        abbrevsDe: ['jon'],                                   chapters: 4 },
  { id: 33, nameEn: 'Micah',           nameDe: 'Micha',             abbrevsEn: ['mic', 'mi'],                  abbrevsDe: ['mi', 'mich'],                            chapters: 7 },
  { id: 34, nameEn: 'Nahum',           nameDe: 'Nahum',             abbrevsEn: ['nah', 'na'],                  abbrevsDe: ['nah'],                                   chapters: 3 },
  { id: 35, nameEn: 'Habakkuk',        nameDe: 'Habakuk',           abbrevsEn: ['hab', 'hb'],                  abbrevsDe: ['hab'],                                   chapters: 3 },
  { id: 36, nameEn: 'Zephaniah',       nameDe: 'Zephanja',          abbrevsEn: ['zeph', 'zep', 'zp'],          abbrevsDe: ['zef', 'zeph'],                           chapters: 3 },
  { id: 37, nameEn: 'Haggai',          nameDe: 'Haggai',            abbrevsEn: ['hag', 'hg'],                  abbrevsDe: ['hag'],                                   chapters: 2 },
  { id: 38, nameEn: 'Zechariah',       nameDe: 'Sacharja',          abbrevsEn: ['zech', 'zec', 'zc'],          abbrevsDe: ['sach', 'sa'],                            chapters: 14 },
  { id: 39, nameEn: 'Malachi',         nameDe: 'Maleachi',          abbrevsEn: ['mal', 'ml'],                  abbrevsDe: ['mal'],                                   chapters: 4 },
  { id: 40, nameEn: 'Matthew',         nameDe: 'Matthäus',          abbrevsEn: ['matt', 'mt', 'mat'],          abbrevsDe: ['mt', 'matt', 'mat'],                     chapters: 28 },
  { id: 41, nameEn: 'Mark',            nameDe: 'Markus',            abbrevsEn: ['mark', 'mk', 'mr', 'mrk'],    abbrevsDe: ['mk', 'mark', 'mr'],                      chapters: 16 },
  { id: 42, nameEn: 'Luke',            nameDe: 'Lukas',             abbrevsEn: ['luke', 'lk', 'lu'],           abbrevsDe: ['lk', 'luk'],                             chapters: 24 },
  { id: 43, nameEn: 'John',            nameDe: 'Johannes',          abbrevsEn: ['john', 'jn', 'jo', 'joh'],    abbrevsDe: ['joh', 'jh', 'jhs'],                      chapters: 21 },
  { id: 44, nameEn: 'Acts',            nameDe: 'Apostelgeschichte', abbrevsEn: ['acts', 'ac'],                 abbrevsDe: ['apg', 'apo'],                            chapters: 28 },
  { id: 45, nameEn: 'Romans',          nameDe: 'Römer',             abbrevsEn: ['rom', 'ro', 'rm'],            abbrevsDe: ['röm', 'roem', 'rö'],                     chapters: 16 },
  { id: 46, nameEn: '1 Corinthians',   nameDe: '1. Korinther',      abbrevsEn: ['1cor', '1co', '1c'],          abbrevsDe: ['1kor', '1ko'],                           chapters: 16 },
  { id: 47, nameEn: '2 Corinthians',   nameDe: '2. Korinther',      abbrevsEn: ['2cor', '2co', '2c'],          abbrevsDe: ['2kor', '2ko'],                           chapters: 13 },
  { id: 48, nameEn: 'Galatians',       nameDe: 'Galater',           abbrevsEn: ['gal', 'ga'],                  abbrevsDe: ['gal', 'ga'],                             chapters: 6 },
  { id: 49, nameEn: 'Ephesians',       nameDe: 'Epheser',           abbrevsEn: ['eph', 'ep'],                  abbrevsDe: ['eph'],                                   chapters: 6 },
  { id: 50, nameEn: 'Philippians',     nameDe: 'Philipper',         abbrevsEn: ['phil', 'php', 'pp'],          abbrevsDe: ['phil', 'phlp'],                          chapters: 4 },
  { id: 51, nameEn: 'Colossians',      nameDe: 'Kolosser',          abbrevsEn: ['col', 'co'],                  abbrevsDe: ['kol'],                                   chapters: 4 },
  { id: 52, nameEn: '1 Thessalonians', nameDe: '1. Thessalonicher', abbrevsEn: ['1thess', '1th', '1t'],        abbrevsDe: ['1thess', '1th'],                         chapters: 5 },
  { id: 53, nameEn: '2 Thessalonians', nameDe: '2. Thessalonicher', abbrevsEn: ['2thess', '2th', '2t'],        abbrevsDe: ['2thess', '2th'],                         chapters: 3 },
  { id: 54, nameEn: '1 Timothy',       nameDe: '1. Timotheus',      abbrevsEn: ['1tim', '1ti', '1tm'],         abbrevsDe: ['1tim', '1ti'],                           chapters: 6 },
  { id: 55, nameEn: '2 Timothy',       nameDe: '2. Timotheus',      abbrevsEn: ['2tim', '2ti', '2tm'],         abbrevsDe: ['2tim', '2ti'],                           chapters: 4 },
  { id: 56, nameEn: 'Titus',           nameDe: 'Titus',             abbrevsEn: ['titus', 'ti', 'tit'],         abbrevsDe: ['tit'],                                   chapters: 3 },
  { id: 57, nameEn: 'Philemon',        nameDe: 'Philemon',          abbrevsEn: ['phlm', 'phm', 'pm'],          abbrevsDe: ['phlm', 'phm'],                           chapters: 1 },
  { id: 58, nameEn: 'Hebrews',         nameDe: 'Hebräer',           abbrevsEn: ['heb', 'he'],                  abbrevsDe: ['hebr', 'heb'],                           chapters: 13 },
  { id: 59, nameEn: 'James',           nameDe: 'Jakobus',           abbrevsEn: ['jas', 'jam', 'jm'],           abbrevsDe: ['jak'],                                   chapters: 5 },
  { id: 60, nameEn: '1 Peter',         nameDe: '1. Petrus',         abbrevsEn: ['1pet', '1pe', '1p'],          abbrevsDe: ['1petr', '1pe', '1ptr'],                  chapters: 5 },
  { id: 61, nameEn: '2 Peter',         nameDe: '2. Petrus',         abbrevsEn: ['2pet', '2pe', '2p'],          abbrevsDe: ['2petr', '2pe', '2ptr'],                  chapters: 3 },
  { id: 62, nameEn: '1 John',          nameDe: '1. Johannes',       abbrevsEn: ['1jn', '1jo', '1joh', '1j'],   abbrevsDe: ['1joh', '1jh'],                           chapters: 5 },
  { id: 63, nameEn: '2 John',          nameDe: '2. Johannes',       abbrevsEn: ['2jn', '2jo', '2joh', '2j'],   abbrevsDe: ['2joh', '2jh'],                           chapters: 1 },
  { id: 64, nameEn: '3 John',          nameDe: '3. Johannes',       abbrevsEn: ['3jn', '3jo', '3joh', '3j'],   abbrevsDe: ['3joh', '3jh'],                           chapters: 1 },
  { id: 65, nameEn: 'Jude',            nameDe: 'Judas',             abbrevsEn: ['jude', 'jud', 'jd'],          abbrevsDe: ['jud'],                                   chapters: 1 },
  { id: 66, nameEn: 'Revelation',      nameDe: 'Offenbarung',       abbrevsEn: ['rev', 're', 'rv'],            abbrevsDe: ['offb', 'off'],                           chapters: 22 },
];

export function normalizeBookKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, '')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss');
}

const aliasIndex = new Map<string, BookEntry>();
for (const book of BOOKS) {
  const aliases = [
    book.nameEn,
    book.nameDe,
    ...book.abbrevsEn,
    ...book.abbrevsDe,
  ];
  for (const alias of aliases) {
    aliasIndex.set(normalizeBookKey(alias), book);
  }
}

export function findBookByName(name: string): BookEntry | undefined {
  return aliasIndex.get(normalizeBookKey(name));
}

export function getBookById(id: number): BookEntry | undefined {
  return BOOKS.find((b) => b.id === id);
}

export function formatReference(
  bookId: number,
  chapter: number,
  verseStart?: number,
  verseEnd?: number,
  lang: 'en' | 'de' = 'en',
): string {
  const book = getBookById(bookId);
  if (!book) return `?${bookId} ${chapter}`;
  const name = lang === 'de' ? book.nameDe : book.nameEn;
  if (!verseStart) return `${name} ${chapter}`;
  if (!verseEnd || verseEnd === verseStart) return `${name} ${chapter}:${verseStart}`;
  return `${name} ${chapter}:${verseStart}-${verseEnd}`;
}

/** Format a non-contiguous verse selection.
 *   en: "Matthew 22:37,39,41-43"
 *   de: "Matthäus 22,37.39.41-43"
 */
export function formatRangeList(
  bookId: number,
  chapter: number,
  ranges: { start: number; end: number }[],
  lang: 'en' | 'de' = 'en',
): string {
  const book = getBookById(bookId);
  if (!book) return `?${bookId} ${chapter}`;
  const name = lang === 'de' ? book.nameDe : book.nameEn;
  if (ranges.length === 0) return `${name} ${chapter}`;
  const chapterSep = lang === 'de' ? ',' : ':';
  const listSep = lang === 'de' ? '.' : ',';
  const versePart = ranges
    .map((r) => (r.start === r.end ? String(r.start) : `${r.start}-${r.end}`))
    .join(listSep);
  return `${name} ${chapter}${chapterSep}${versePart}`;
}
