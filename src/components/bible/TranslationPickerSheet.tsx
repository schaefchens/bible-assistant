import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { TranslationList } from './TranslationList';
import type { Translation } from '@/services/bible/bibleApi';

type Props = {
  open: boolean;
  value: Translation;
  onChange: (code: Translation) => void;
  onClose: () => void;
};

/**
 * Bottom-sheet wrapper around <TranslationList />. Mirrors the chat book
 * picker's "translations" sub-view chrome so the Settings translation
 * picker presents the same way users already learnt there. Auto-closes
 * after a selection via the same onChange handler.
 */
export function TranslationPickerSheet({ open, value, onChange, onClose }: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        aria-hidden={!open}
        onClick={onClose}
        className={
          'fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ' +
          (open ? 'opacity-100' : 'pointer-events-none opacity-0')
        }
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('chat.bookPicker.translations') as string}
        className={
          'fixed left-0 right-0 bottom-0 z-50 ' +
          'rounded-t-3xl bg-surface-sunken border-t border-brand/30 shadow-2xl ' +
          'transition-transform duration-300 ease-out will-change-transform ' +
          (open ? 'translate-y-0' : 'translate-y-full')
        }
        style={{ maxHeight: '85vh' }}
      >
        <div className="flex flex-col" style={{ maxHeight: '85vh' }}>
          <div className="flex flex-col items-center pt-2 pb-1">
            <div className="h-1.5 w-12 rounded-full bg-ink/20" />
          </div>
          <div className="flex items-center justify-between px-5 pb-3">
            <h2 className="font-serif text-brand text-lg">
              {t('chat.bookPicker.translations')}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close') as string}
              className="text-ink-muted hover:text-ink transition-colors text-2xl leading-none px-2"
            >
              ×
            </button>
          </div>
          <TranslationList
            value={value}
            onChange={(code) => {
              onChange(code);
              onClose();
            }}
            className="flex-1 min-h-0 overflow-y-auto pb-safe"
          />
        </div>
      </div>
    </>
  );
}
