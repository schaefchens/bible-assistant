import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPlaybackPlan } from '@/lib/playbackPlan';
import { localeForTranslation } from '@/lib/translationLocaleMap';
import { BOOKS } from '@/services/bible/bookCatalog';
import type { Translation } from '@/services/bible/bibleApi';
import type { VerseSummary } from '@/types/domain';

/**
 * A voice shared on a shelf "for scripture" reads verses and the announcements
 * around them — on its owner's key, so the server checks every text it is
 * asked to read (isAnnouncement() in public/api/sponsorship.php), against a
 * table generated from the client's own templates and book names
 * (public/api/announcements.php, `npm run voices:announcements`).
 *
 * If the two disagree the failure is silent and audible: the server refuses
 * one heading, and the rest of the chapter reads in Echo. So every
 * announcement the real buildPlaybackPlan() makes — every book, both
 * languages, every heading shape, both verse-number styles — goes through the
 * real matcher. A stale table fails here.
 *
 * It spawns `php`, because the matcher is PHP and this is the lowest layer
 * that can hold the client's output against it; a port of either side into
 * the other language would be the two-copies failure this repo keeps a table
 * of. php is on every machine that runs `npm run verify` already.
 */

const repo = join(__dirname, '..', '..');

type Case = { text: string; lang: 'en' | 'de' | '_' };

/** isAnnouncement() over every case, in one php process. */
function phpAccepts(cases: Case[]): boolean[] {
  const run = spawnSync(
    'php',
    [
      '-d', 'opcache.enable_cli=0',
      '-r',
      'define("APP_ROOT", sys_get_temp_dir());' +
        ' require getenv("BA_API") . "/announcements.php"; require getenv("BA_API") . "/sponsorship.php";' +
        ' $out = []; foreach (json_decode(stream_get_contents(STDIN), true) as $c) $out[] = isAnnouncement($c["text"], $c["lang"]);' +
        ' echo json_encode($out);',
    ],
    { input: JSON.stringify(cases), encoding: 'utf8', env: { ...process.env, BA_API: join(repo, 'public', 'api') } },
  );
  if (run.error) throw new Error(`php is required to run this test: ${run.error.message}`);
  expect(run.status, run.stderr || run.stdout).toBe(0);
  return JSON.parse(run.stdout) as boolean[];
}

const verse = (translation: Translation, bookId: number, chapter: number, n: number): VerseSummary => ({
  translation,
  bookId,
  chapter,
  verse: n,
  text: 'x',
  display: '',
});

/** Every heading and verse number the plan builder says for these verses. */
function announcementsOf(
  verses: VerseSummary[],
  opts: { wholeChapter: boolean; verseNumberStyle: 'spoken' | 'plain' },
): Case[] {
  return buildPlaybackPlan(verses, {
    locale: 'en',
    readChapterHeadings: true,
    readVerseNumbers: true,
    verseNumberStyle: opts.verseNumberStyle,
    pauseBetweenVersesMs: 0,
    pauseBetweenChaptersMs: 0,
    wholeChapter: opts.wholeChapter,
  }).flatMap((it) =>
    it.kind === 'verse' ? [] : [{ text: it.text, lang: localeForTranslation(it.translation) }],
  );
}

describe('every announcement the app makes is one a shared voice may read', () => {
  it('in both languages, for every book, every heading and both number styles', () => {
    const cases = new Map<string, Case>();
    const add = (c: Case) => cases.set(`${c.lang}|${c.text}`, c);
    for (const translation of ['KJV', 'LUT'] as const) {
      for (const book of BOOKS) {
        for (const chapter of new Set([1, book.chapters])) {
          const at = (...ns: number[]) => ns.map((n) => verse(translation, book.id, chapter, n));
          for (const verseNumberStyle of ['spoken', 'plain'] as const) {
            // A whole chapter, one verse, a range, and a list with gaps — the
            // four shapes headingTextFor() has.
            announcementsOf(at(1), { wholeChapter: true, verseNumberStyle }).forEach(add);
            announcementsOf(at(176), { wholeChapter: false, verseNumberStyle }).forEach(add);
            announcementsOf(at(2, 3, 4), { wholeChapter: false, verseNumberStyle }).forEach(add);
            announcementsOf(at(1, 3), { wholeChapter: false, verseNumberStyle }).forEach(add);
            announcementsOf(at(1, 3, 7, 12), { wholeChapter: false, verseNumberStyle }).forEach(add);
          }
        }
      }
    }
    const all = [...cases.values()];
    // Four heading shapes, five number texts, two styles: well over a thousand.
    expect(all.length).toBeGreaterThan(1000);
    const accepted = phpAccepts(all);
    const refused = all.filter((_, i) => !accepted[i]);
    expect(refused).toEqual([]);
  });

  it('and nothing else: prose that only borrows the shape is refused', () => {
    const prose: Case[] = [
      { text: 'Kill them all, chapter 1', lang: 'en' },
      { text: 'Genesis, chapter 1 — and now something else entirely', lang: 'en' },
      { text: 'Verse 16 is my favourite', lang: 'en' },
      { text: 'Psalms 23', lang: 'en' },
      { text: 'Genesis, chapter 1, verses 1', lang: 'en' },
      { text: 'A morning by the river. By Alice.', lang: 'en' },
      { text: 'Genesis, chapter 1, verses 1, 3, and buy now', lang: 'en' },
      { text: 'Galater, Kapitel 5, Verse 22 bis morgen', lang: 'de' },
      // A German heading is not an English one, when the language is named.
      { text: '1. Mose, Kapitel 1', lang: 'en' },
      { text: '', lang: '_' },
      { text: '0', lang: '_' },
      { text: ' 16', lang: '_' },
    ];
    expect(phpAccepts(prose)).toEqual(prose.map(() => false));
  });
});
