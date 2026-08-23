import { useTranslation } from 'react-i18next';
import { PackActionButton } from '@/components/bible/PackActionButton';
import { formatReference } from '@/services/bible/bookCatalog';
import { getTranslationInfo } from '@/services/bible/translationCatalog';
import { useReaderStore, type ReaderError } from '@/store/readerStore';

type Props = {
  error: ReaderError;
  onRetry: () => void;
  onPickTranslation: () => void;
};

/**
 * Shown in place of a chapter that wouldn't load. Two distinct situations:
 *
 * - `unavailable` — this text genuinely doesn't have that chapter, or its pack
 *   isn't downloaded. The useful action is downloading the pack (or switching
 *   translation), so the download button is right here rather than buried in
 *   Settings. On native this is also the main path a user discovers that the
 *   whole Bible can live on the device.
 * - `network` — a fetch failed. Offer a retry.
 *
 * Never auto-retried: the endless-scroll sentinel is suppressed while an error
 * is set, otherwise it would hammer a dead endpoint on every scroll frame.
 */
export function ChapterUnavailableCard({ error, onRetry, onPickTranslation }: Props) {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'de' = (i18n.language || 'en').startsWith('de') ? 'de' : 'en';
  const clearError = useReaderStore((s) => s.clearError);

  const reference = formatReference(error.bookId, error.chapter, undefined, undefined, lang);
  const translationName = getTranslationInfo(error.translation).name;

  return (
    <div className="my-4 rounded-2xl border border-brand/25 bg-surface-raised/30 px-4 py-4">
      <p className="font-serif text-ink/90">
        {error.kind === 'unavailable'
          ? t('read.unavailable', { translation: translationName, reference })
          : t('read.failed', { reference })}
      </p>

      {error.kind === 'unavailable' && (
        <>
          <p className="mt-1 text-sm text-ink-muted">{t('read.unavailableHint')}</p>
          <div className="mt-3">
            <PackActionButton code={error.translation} />
          </div>
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            clearError();
            onRetry();
          }}
          className="h-9 px-3 text-sm rounded-xl border border-brand/30 text-brand hover:bg-brand/10 active:scale-[0.98] transition-all"
        >
          {t('read.retry')}
        </button>
        <button
          type="button"
          onClick={onPickTranslation}
          className="h-9 px-3 text-sm rounded-xl border border-surface-raised text-ink-muted hover:text-ink hover:border-brand/30 active:scale-[0.98] transition-all"
        >
          {t('read.switchTranslation')}
        </button>
      </div>
    </div>
  );
}
