import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { BookChapterPicker } from '@/components/chat/BookChapterPicker';
import { playSegmentInReader } from '@/lib/readingListPlayback';
import { BIBLE_SOURCE, formatSegment } from '@/services/reading/readingSequence';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { NarrationDownloadButton } from './NarrationDownloadButton';

type Props = {
  /**
   * Opens the translation sheet. The sheet itself is owned by ReadPage, not
   * mounted here: this header sets `backdrop-blur`, and a `backdrop-filter`
   * makes an element a containing block for `position: fixed` descendants — so a
   * sheet rendered inside would anchor to the 48px-tall header instead of the
   * viewport and sit in the middle of the page while "closed".
   */
  onOpenTranslations: () => void;
  /** Opens the reading-appearance sheet. Owned by ReadPage for the same reason. */
  onOpenAppearance: () => void;
};

/**
 * The reader's top bar: what you're reading (tap to jump), which translation
 * (tap to switch), and the paged/endless toggle.
 */
export function ReaderHeader({ onOpenTranslations, onOpenAppearance }: Props) {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'de' = (i18n.language || 'en').startsWith('de') ? 'de' : 'en';

  const translation = useSettingsStore((s) => s.translation);
  const endless = useSettingsStore((s) => s.readerEndlessScroll);
  const setEndless = useSettingsStore((s) => s.setReaderEndlessScroll);

  const position = useReaderStore((s) => s.position);
  const goTo = useReaderStore((s) => s.goTo);
  const setSource = useReaderStore((s) => s.setSource);
  const source = useReaderStore((s) => s.source);
  const listName = useLibraryStore((s) =>
    source.kind === 'list' ? s.readingLists.find((l) => l.id === source.listId)?.name : undefined,
  );

  const label = position ? formatSegment(position, lang) : t('read.title');

  return (
    <header className="flex items-center justify-between gap-2 px-4 py-2 border-b border-surface-raised/50 bg-surface/90 backdrop-blur">
      <BookChapterPicker
        showReadingLists
        // Choosing a chapter out of the Bible *is* choosing to read the Bible,
        // so it leaves whatever list was being followed. No separate control.
        onPick={(bookId, chapter) => {
          void setSource(BIBLE_SOURCE).then(() =>
            goTo({ translation, bookId, chapter }),
          );
        }}
        // Continue *reads*, unlike a passage tap: it is the "carry on where I
        // left off" button, and stopping at a jump would make it a slower way to
        // do what tapping the passage already does.
        onContinue={(ref) => {
          void playSegmentInReader(ref);
        }}
        // A list passage jumps the page instead of reading aloud: the reader's
        // own play button is right there, and the chapter tap above doesn't
        // start audio either.
        onPickSegment={(ref) => {
          void (ref.listId
            ? useReaderStore
                .getState()
                .setSource({ kind: 'list', listId: ref.listId })
                .then(() => goTo(ref))
            : goTo(ref));
        }}
        trigger={(open) => (
          <button
            type="button"
            onClick={open}
            aria-label={t('read.pickChapter') as string}
            className="flex items-center gap-1.5 min-w-0 text-brand hover:text-brand-bright transition-colors"
          >
            <span className="min-w-0 text-left leading-tight">
              {listName && (
                <span className="block text-[10px] uppercase tracking-wider text-brand-muted truncate">
                  {listName}
                </span>
              )}
              <span className="block font-serif text-lg truncate">{label}</span>
            </span>
            <ChevronDown />
          </button>
        )}
      />

      <div className="flex items-center gap-1 shrink-0">
        {position && (
          <NarrationDownloadButton
            translation={translation}
            bookId={position.bookId}
            chapter={position.chapter}
          />
        )}
        <button
          type="button"
          onClick={onOpenTranslations}
          aria-label={t('read.switchTranslation') as string}
          className="px-2 py-1 text-[10px] uppercase tracking-wider text-brand-muted hover:text-brand transition-colors"
        >
          {translation}
        </button>
        <button
          type="button"
          onClick={() => setEndless(!endless)}
          aria-pressed={endless}
          aria-label={t('settings.reader.endlessScroll') as string}
          title={t('settings.reader.endlessScroll') as string}
          className={clsx(
            'h-8 w-8 rounded-lg flex items-center justify-center transition-all active:scale-95',
            endless ? 'bg-brand/20 text-brand' : 'text-ink-muted hover:text-ink',
          )}
        >
          <ScrollIcon />
        </button>
        <button
          type="button"
          onClick={onOpenAppearance}
          aria-label={t('read.appearance.open') as string}
          title={t('read.appearance.open') as string}
          className="h-8 w-8 rounded-lg flex items-center justify-center text-ink-muted hover:text-ink transition-all active:scale-95"
        >
          <TypeIcon />
        </button>
      </div>
    </header>
  );
}

function ChevronDown() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/** Type glyph: a small A beside a large one, the universal "text settings" mark. */
function TypeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6.1 14.2h3.3l.7 2.1h1.8L8.6 7.7H7L3.7 16.3h1.7l.7-2.1zm1.6-4.9 1.2 3.5H6.5l1.2-3.5z" />
      <path d="M16.3 19.3h2.2l1 2.7h2.2L17.9 9.6h-1.9L11.9 22h2.1l1-2.7zm1.1-6.8 1.6 4.9h-3.2l1.6-4.9z" />
    </svg>
  );
}

/** Continuous-scroll glyph: a page with flowing lines running off the bottom. */
function ScrollIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="5" y1="6" x2="19" y2="6" />
      <line x1="5" y1="10" x2="19" y2="10" />
      <line x1="5" y1="14" x2="15" y2="14" />
      <polyline points="9 18 12 21 15 18" />
    </svg>
  );
}
