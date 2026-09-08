import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { BOOKS, bookName } from '@/services/bible/bookCatalog';
import { getTranslationInfo } from '@/services/bible/translationCatalog';
import type { Translation } from '@/services/bible/bibleApi';
import { BookIcon } from '@/components/common/icons';
import { ChevronRight, PickerBand } from './pickerRows';

/**
 * Picking scripture: the translation button, the two book columns, and the
 * chapter grid. `{ kind: 'bible' }`'s half of the picker.
 */

type Book = (typeof BOOKS)[number];

/** Which text the books will be read in — a row, because it also leads somewhere. */
export function TranslationBand({
  translation,
  onOpen,
}: {
  translation: Translation;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const info = getTranslationInfo(translation);
  return (
    <PickerBand>
      <button
        type="button"
        onClick={onOpen}
        aria-label={t('chat.bookPicker.changeTranslation') as string}
        className={clsx(
          'w-full flex items-center gap-3 rounded-xl px-3 py-2.5',
          'bg-surface/60 border border-brand/30 hover:border-brand/60 hover:bg-surface/80',
          'transition-colors text-left',
        )}
      >
        <BookIcon className="text-brand shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block font-serif text-brand text-sm leading-tight truncate">
            {info.name}
          </span>
          <span className="block text-xs text-ink-muted/80 mt-0.5">
            {info.year} ·{' '}
            {info.language === 'de'
              ? t('chat.bookPicker.languageDe')
              : t('chat.bookPicker.languageEn')}
          </span>
        </span>
        <ChevronRight />
      </button>
    </PickerBand>
  );
}

/** The two testaments, side by side, each scrolling on its own. */
export function BookColumns({
  lang,
  onPickBook,
}: {
  lang: 'en' | 'de';
  onPickBook: (bookId: number) => void;
}) {
  const { t } = useTranslation();
  const { ot, nt } = useMemo(
    () => ({ ot: BOOKS.filter((b) => b.id <= 39), nt: BOOKS.filter((b) => b.id >= 40) }),
    [],
  );

  const column = (books: Book[], heading: string, className: string) => (
    <div className={clsx('flex flex-col', className)}>
      <h3 className="shrink-0 px-3 pt-2 pb-2 text-xs uppercase tracking-wider text-ink-muted/70 font-serif border-b border-surface-raised/40">
        {heading}
      </h3>
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {books.map((book) => (
          <button
            key={book.id}
            type="button"
            onClick={() => onPickBook(book.id)}
            className="w-full text-left px-3 py-2 text-sm leading-snug text-ink hover:bg-brand/10 active:bg-brand/15 transition-colors"
          >
            {bookName(book, lang)}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex flex-1 min-h-0 pb-safe">
      {column(ot, t('chat.bookPicker.oldTestament') as string, 'w-1/2 border-r border-surface-raised/40')}
      {column(nt, t('chat.bookPicker.newTestament') as string, 'w-1/2')}
    </div>
  );
}

/** Every chapter of the chosen book. */
export function ChapterGrid({
  book,
  disabled,
  onPick,
}: {
  book: Book;
  /** The chat path can be busy mid-turn; a reader jump never is. */
  disabled: boolean;
  onPick: (chapter: number) => void;
}) {
  const chapters = useMemo(
    () => Array.from({ length: book.chapters }, (_, i) => i + 1),
    [book.chapters],
  );
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 pb-safe">
      <div className="grid grid-cols-5 sm:grid-cols-7 md:grid-cols-9 gap-2">
        {chapters.map((chapter) => (
          <button
            key={chapter}
            type="button"
            disabled={disabled}
            onClick={() => onPick(chapter)}
            className={clsx(
              'aspect-square rounded-xl bg-surface border border-surface-raised/50',
              'text-ink text-sm font-mono',
              'hover:bg-brand/10 hover:border-brand/40 active:scale-95',
              'transition-colors',
              'disabled:opacity-40 disabled:pointer-events-none',
            )}
          >
            {chapter}
          </button>
        ))}
      </div>
    </div>
  );
}
