import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  TRANSLATIONS,
  type TranslationInfo,
} from '@/services/bible/translationCatalog';
import type { Translation } from '@/services/bible/bibleApi';

type Props = {
  value: Translation;
  onChange: (code: Translation) => void;
  /** Extra classes for the outer wrapper (scroll area, card chrome, …). */
  className?: string;
};

/**
 * Grouped, richly-labelled list of Bible translations (code badge, full
 * name, year · language · blurb). Shared by the book/chapter picker's
 * translation view and the Settings translation section.
 */
export function TranslationList({ value, onChange, className }: Props) {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'de' = (i18n.language || 'en').startsWith('de') ? 'de' : 'en';

  const { enTrans, deTrans } = useMemo(
    () => ({
      enTrans: TRANSLATIONS.filter((tr) => tr.language === 'en'),
      deTrans: TRANSLATIONS.filter((tr) => tr.language === 'de'),
    }),
    [],
  );

  const renderRow = (tr: TranslationInfo) => {
    const selected = tr.code === value;
    const langLabel =
      tr.language === 'de'
        ? t('chat.bookPicker.languageDe')
        : t('chat.bookPicker.languageEn');
    return (
      <button
        key={tr.code}
        type="button"
        onClick={() => onChange(tr.code)}
        className={clsx(
          'w-full text-left px-4 py-3 transition-colors border-l-2 flex items-start gap-3',
          selected
            ? 'bg-gold/15 border-gold'
            : 'hover:bg-gold/5 border-transparent',
        )}
      >
        <span
          className={clsx(
            'shrink-0 mt-0.5 inline-flex items-center justify-center',
            'min-w-[3rem] px-2 py-0.5 rounded-md text-xs font-mono tracking-wide',
            'border',
            selected
              ? 'border-gold/60 text-gold bg-gold/10'
              : 'border-navy-soft/60 text-cream-dim bg-navy/40',
          )}
        >
          {tr.code}
        </span>
        <span className="flex-1 min-w-0">
          <span
            className={clsx(
              'block font-serif text-sm leading-tight',
              selected ? 'text-gold' : 'text-cream',
            )}
          >
            {tr.name}
          </span>
          <span className="block text-xs text-cream-dim/80 mt-0.5">
            {tr.year} · {langLabel} · {tr.blurb[lang]}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className={className}>
      <h3 className="px-4 pt-2 pb-1 text-xs uppercase tracking-wider text-cream-dim/70 font-serif">
        {t('chat.bookPicker.languageEn')}
      </h3>
      {enTrans.map(renderRow)}
      <h3 className="px-4 pt-4 pb-1 text-xs uppercase tracking-wider text-cream-dim/70 font-serif">
        {t('chat.bookPicker.languageDe')}
      </h3>
      {deTrans.map(renderRow)}
    </div>
  );
}
