import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CARD_COLORS, type CardColor } from '@/types/domain';
import { colorClasses } from './cardColors';

/**
 * The inline editor for a board's name, emoji, colour and background.
 *
 * Its own file because it is a *popover*, not part of the tab strip it used to
 * live in: it shares no state with the rail, and the strip's own concerns —
 * three coupled z-index values, the one-axis scroll trio, the card-drop
 * hit-testing — are hard enough to hold without 112 lines of form in the
 * middle of them.
 *
 * Positioned `absolute right-2 top-full` against whichever control opened it,
 * so it stays a child of that control's relative container rather than a
 * portal: it is anchored to the `+` or the `⋮` that summoned it.
 */

export type BoardValues = { name: string; emoji?: string; color?: CardColor; background?: string };

export function BoardEditor({
  title,
  initial,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial?: BoardValues;
  onSubmit: (values: BoardValues) => Promise<void> | void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [emoji, setEmoji] = useState(initial?.emoji ?? '');
  const [color, setColor] = useState<CardColor>(initial?.color ?? 'none');
  const [background, setBackground] = useState(initial?.background ?? '');
  const submit = () => void onSubmit({ name, emoji, color, background });
  return (
    <div className="absolute right-2 top-full mt-1 z-30 bg-surface-raised rounded-xl shadow-lg border border-surface-raised/70 p-3 w-80 max-w-[calc(100vw-1rem)] space-y-3">
      <div className="text-xs uppercase tracking-wider text-ink-muted">{title}</div>
      <div className="flex gap-2">
        <input
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') onCancel();
          }}
          maxLength={4}
          placeholder="✨"
          aria-label={t('boards.emoji') as string}
          className="w-14 bg-surface rounded-lg px-2 py-1.5 text-ink text-center text-xl outline-none focus:ring-2 focus:ring-brand/60"
        />
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') onCancel();
          }}
          placeholder={t('boards.boardName') as string}
          className="flex-1 bg-surface rounded-lg px-3 py-1.5 text-ink outline-none focus:ring-2 focus:ring-brand/60 text-sm"
        />
      </div>
      <div>
        <div className="text-xs text-ink-muted mb-1.5">{t('boards.color')}</div>
        <div className="flex flex-wrap gap-2">
          {CARD_COLORS.map((c) => {
            const cls = colorClasses(c);
            const selected = color === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={t(`boards.colors.${c}`) as string}
                aria-pressed={selected}
                className={[
                  'w-7 h-7 rounded-full border transition-all',
                  cls.swatch,
                  selected
                    ? 'border-brand ring-2 ring-brand/60 scale-110'
                    : 'border-black/20 hover:scale-105',
                  c === 'none' ? 'border-ink-muted/40' : '',
                ].join(' ')}
              />
            );
          })}
        </div>
      </div>
      <div>
        <div className="text-xs text-ink-muted mb-1.5">{t('boards.background')}</div>
        <div className="flex gap-2">
          <input
            type="url"
            inputMode="url"
            maxLength={2048}
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              else if (e.key === 'Escape') onCancel();
            }}
            placeholder="https://…"
            aria-label={t('boards.background') as string}
            className="flex-1 min-w-0 bg-surface rounded-lg px-3 py-1.5 text-ink outline-none focus:ring-2 focus:ring-brand/60 text-sm"
          />
          {background.trim() !== '' && (
            <button
              type="button"
              onClick={() => setBackground('')}
              aria-label={t('boards.backgroundClear') as string}
              title={t('boards.backgroundClear') as string}
              className="btn-ghost text-sm px-2 shrink-0"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-ghost text-sm" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className="btn-primary text-sm" onClick={submit}>
          {t('boards.save')}
        </button>
      </div>
    </div>
  );
}
