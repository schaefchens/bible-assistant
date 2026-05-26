import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useChatStore } from '@/store/chatStore';
import { useCommandPipeline } from '@/hooks/useCommandPipeline';
import { BOOKS, getBookById } from '@/services/bible/bookCatalog';
import { audioPlayback } from '@/lib/audioPlaybackManager';

export function BookChapterPicker() {
  const { t, i18n } = useTranslation();
  const isProcessing = useChatStore((s) => s.isProcessing);
  const { send } = useCommandPipeline();
  const [open, setOpen] = useState(false);
  const [selectedBookId, setSelectedBookId] = useState<number>(1);

  const lang: 'en' | 'de' = (i18n.language || 'en').startsWith('de') ? 'de' : 'en';
  const { ot, nt } = useMemo(
    () => ({
      ot: BOOKS.filter((b) => b.id <= 39),
      nt: BOOKS.filter((b) => b.id >= 40),
    }),
    [],
  );
  const selectedBook = getBookById(selectedBookId) ?? BOOKS[0];
  const chapters = useMemo(
    () => Array.from({ length: selectedBook.chapters }, (_, i) => i + 1),
    [selectedBook.chapters],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const bookLabel = (book: (typeof BOOKS)[number]) =>
    lang === 'de' ? book.nameDe : book.nameEn;

  const renderBookButton = (book: (typeof BOOKS)[number]) => {
    const selected = book.id === selectedBookId;
    return (
      <button
        key={book.id}
        type="button"
        onClick={() => setSelectedBookId(book.id)}
        className={clsx(
          'w-full text-left px-4 py-2 text-sm transition-colors border-l-2',
          selected
            ? 'bg-gold/15 text-gold border-gold'
            : 'text-cream hover:bg-gold/10 border-transparent',
        )}
      >
        {bookLabel(book)}
      </button>
    );
  };

  return (
    <>
      <button
        type="button"
        aria-label={t('chat.bookPicker.open') as string}
        title={t('chat.bookPicker.open') as string}
        onClick={() => setOpen(true)}
        className="text-cream-dim hover:text-cream disabled:opacity-30 px-2 py-1 transition-colors"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      </button>

      {createPortal(
        <>
          <div
            aria-hidden={!open}
            onClick={() => setOpen(false)}
            className={clsx(
              'fixed inset-0 z-40 bg-black/50 transition-opacity duration-200',
              open ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('chat.bookPicker.title') as string}
            className={clsx(
              'fixed left-0 right-0 bottom-0 z-50',
              'rounded-t-3xl bg-navy-deep border-t border-gold/30 shadow-2xl',
              'transition-transform duration-300 ease-out will-change-transform',
              open ? 'translate-y-0' : 'translate-y-full',
            )}
            style={{ maxHeight: '85vh' }}
          >
        <div className="flex flex-col" style={{ maxHeight: '85vh' }}>
          <div className="flex flex-col items-center pt-2 pb-1">
            <div className="h-1.5 w-12 rounded-full bg-cream/20" />
          </div>
          <div className="flex items-center justify-between px-5 pb-3">
            <h2 className="font-serif text-gold text-lg">
              {t('chat.bookPicker.title')}
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('common.close') as string}
              className="text-cream-dim hover:text-cream transition-colors text-2xl leading-none px-2"
            >
              ×
            </button>
          </div>
          <div className="flex flex-1 min-h-0 pb-safe" style={{ minHeight: '60vh' }}>
            <div className="w-2/5 overflow-y-auto border-r border-navy-soft/40 py-2">
              <h3 className="px-4 pt-2 pb-1 text-xs uppercase tracking-wider text-cream-dim/70 font-serif">
                {t('chat.bookPicker.oldTestament')}
              </h3>
              {ot.map(renderBookButton)}
              <h3 className="px-4 pt-4 pb-1 text-xs uppercase tracking-wider text-cream-dim/70 font-serif">
                {t('chat.bookPicker.newTestament')}
              </h3>
              {nt.map(renderBookButton)}
            </div>
            <div className="w-3/5 overflow-y-auto p-3">
              <div className="px-1 pb-2 text-xs text-cream-dim/70 font-serif">
                {bookLabel(selectedBook)}
              </div>
              <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 gap-2">
                {chapters.map((chapter) => (
                  <button
                    key={chapter}
                    type="button"
                    disabled={isProcessing}
                    onClick={() => {
                      audioPlayback.ensureContext();
                      void send(`Read ${selectedBook.nameEn} ${chapter}`);
                      setOpen(false);
                    }}
                    className={clsx(
                      'aspect-square rounded-xl bg-navy border border-navy-soft/50',
                      'text-cream text-sm font-mono',
                      'hover:bg-gold/10 hover:border-gold/40 active:scale-95',
                      'transition-colors',
                      'disabled:opacity-40 disabled:pointer-events-none',
                    )}
                  >
                    {chapter}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
        </>,
        document.body,
      )}
    </>
  );
}
