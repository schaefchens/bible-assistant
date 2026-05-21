import { useTranslation } from 'react-i18next';

type Props = {
  allTags: string[];
  selected: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
};

export function TagFilterBar({ allTags, selected, onToggle, onClear }: Props) {
  const { t } = useTranslation();
  return (
    <div className="px-3 pt-1 pb-2">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1 min-h-[30px]">
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-gold-dim">
          {t('cards.filterByTags')}
        </span>
        {allTags.length === 0 && (
          <span className="shrink-0 text-xs text-cream-dim italic">
            {t('cards.noTagsYet')}
          </span>
        )}
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 rounded-full px-2 py-1 text-xs bg-navy-soft text-cream-dim hover:text-cream"
            aria-label={t('common.cancel') as string}
          >
            ✕
          </button>
        )}
        {allTags.map((tag) => {
          const isSel = selected.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => onToggle(tag)}
              className={[
                'shrink-0 rounded-full px-3 py-1 text-xs transition-colors',
                isSel
                  ? 'bg-gold text-navy'
                  : 'bg-navy-soft text-cream-dim hover:text-cream',
              ].join(' ')}
            >
              #{tag}
            </button>
          );
        })}
      </div>
    </div>
  );
}
