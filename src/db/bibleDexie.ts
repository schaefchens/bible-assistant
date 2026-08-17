import Dexie, { type Table } from 'dexie';
import type { Translation } from '@/services/bible/bibleApi';

/**
 * Downloaded Bible packs.
 *
 * Deliberately a *separate* database from 'bible-assistant': bulk-writing 66
 * large rows holds a write transaction, and doing that in the same DB as the
 * card/board sync queue would block library sync mid-download. It also keeps
 * this feature out of that DB's migration chain, and makes "delete all offline
 * Bibles" a single Dexie.delete().
 */

export type BookPackRow = {
  /** `${code}:${bookId}` */
  key: string;
  code: Translation;
  bookId: number;
  version: string;
  bytes: number;
  /** Raw pack JSON as a *string*, not a parsed object. Structured-cloning a
   * nested array-of-objects into IndexedDB is dramatically slower to write and
   * read than one string, and JSON.parse of a ~76 KB string is well under a
   * millisecond. Keeping it as text also means the stored bytes stay
   * verifiable against the manifest's sha256. */
  json: string;
};

export type PackState = 'partial' | 'installed';

export type PackMetaRow = {
  code: Translation;
  version: string;
  state: PackState;
  booksDone: number;
  bytes: number;
  installedAt: number;
};

class BiblePackDb extends Dexie {
  books!: Table<BookPackRow, string>;
  meta!: Table<PackMetaRow, string>;

  constructor() {
    super('bible-assistant-packs');
    this.version(1).stores({
      books: 'key, code',
      meta: 'code',
    });
  }
}

export const packDb = new BiblePackDb();

export function bookKey(code: Translation, bookId: number): string {
  return `${code}:${bookId}`;
}
