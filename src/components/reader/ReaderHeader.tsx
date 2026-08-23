import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { BookChapterPicker } from '@/components/chat/BookChapterPicker';
import { formatReference } from '@/services/bible/bookCatalog';
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
};

/**
 * The reader's top bar: what you're reading (tap to jump), which translation
 * (tap to switch), and the paged/endless toggle.
 */
export function ReaderHeader({ onOpenTranslations }: Props) {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'de' = (i18n.language || 'en').startsWith('de') ? 'de' : 'en';

  const translation = useSettingsStore((s) => s.translation);
  const endless = useSettingsStore((s) => s.readerEndlessScroll);
  const setEndless = useSettingsStore((s) => s.setReaderEndlessScroll);

  const position = useReaderStore((s) => s.position);
  const goTo = useReaderStore((s) => s.goTo);

  const label = position
    ? formatReference(position.bookId, position.chapter, undefined, undefined, lang)
    : t('read.title');

  return (
    <header className="flex items-center justify-between gap-2 px-4 py-2 border-b border-surface-raised/50 bg-surface/90 backdrop-blur">
      <BookChapterPicker
        onPick={(bookId, chapter) => {
          void goTo({ translation, bookId, chapter });
        }}
        trigger={(open) => (
          <button
            type="button"
            onClick={open}
            aria-label={t('read.pickChapter') as string}
            className="flex items-center gap-1.5 min-w-0 text-brand hover:text-brand-bright transition-colors"
          >
            <span className="font-serif text-lg truncate">{label}</span>
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
