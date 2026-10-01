import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useLocale } from '@/hooks/useLocale';
import type { VoiceShareScope, VoiceSharing } from '@/services/voices/voiceSharing';
import { chaptersHint } from './voiceSharingLabels';

/** What a month's allowance may be set to — for everyone together. */
const MONTHLY = [20_000, 50_000, 100_000, 250_000];
/** And a day's, for each reader. */
const DAILY = [3_500, 7_000, 14_000, 35_000];

/**
 * The terms a voice is lent on: what it may read for the shelf's readers, and
 * how much of the owner's key they may spend.
 *
 * Every field is enforced by the server at the moment of spending
 * (public/api/sponsorship.php) — this only chooses them. Characters are the
 * unit both providers bill in, so they are what is set; "about N chapters" is
 * beside each, because nobody thinks in characters.
 *
 * `requirePool`: on a shelf that lets anyone with the code in, "no monthly
 * limit" is not offered — every new identity would bring a fresh day, so the
 * pool is the only real limit there, and the server refuses to spend without
 * one.
 */
export function VoiceSharingForm({
  value,
  onChange,
  requirePool = false,
}: {
  value: VoiceSharing;
  onChange: (next: VoiceSharing) => void;
  requirePool?: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);

  const scopes: { scope: VoiceShareScope; label: string; hint: string }[] = [
    { scope: 'scripture', label: t('voiceSharing.form.scripture'), hint: t('voiceSharing.form.scriptureHint') },
    { scope: 'pieces', label: t('voiceSharing.form.pieces'), hint: t('voiceSharing.form.piecesHint') },
    { scope: 'anything', label: t('voiceSharing.form.anything'), hint: t('voiceSharing.form.anythingHint') },
  ];

  const set = (patch: Partial<VoiceSharing>) => {
    const next: VoiceSharing = { ...value, ...patch };
    // Absent, not undefined-valued: the payload omits what is not set.
    if (next.monthly === undefined) delete next.monthly;
    if (next.dailyPerReader === undefined) delete next.dailyPerReader;
    onChange(next);
  };

  return (
    <div className="space-y-5">
      <fieldset className="space-y-1.5">
        <legend className="text-sm text-ink mb-1.5">{t('voiceSharing.form.reads')}</legend>
        {scopes.map(({ scope, label, hint }) => (
          <button
            key={scope}
            type="button"
            role="radio"
            aria-checked={value.scope === scope}
            onClick={() => set({ scope })}
            className={clsx(
              'w-full text-left rounded-xl px-3 py-2 transition-colors',
              value.scope === scope ? 'bg-brand/15 ring-1 ring-brand/40' : 'bg-surface-raised/60',
            )}
          >
            <span className="block text-sm text-ink">{label}</span>
            <span className="block text-[11px] text-ink-muted leading-snug">{hint}</span>
          </button>
        ))}
      </fieldset>

      <Allowance
        legend={t('voiceSharing.form.monthly')}
        hint={t('voiceSharing.form.monthlyHint')}
        presets={MONTHLY}
        value={value.monthly}
        allowNone={!requirePool}
        noneLabel={t('voiceSharing.form.noLimit')}
        format={n}
        chapters={(c) => chaptersHint(c, t)}
        onPick={(monthly) => set({ monthly })}
      />
      {requirePool && (
        <p className="-mt-3 text-[11px] text-amber-400">{t('voiceSharing.form.poolRequired')}</p>
      )}

      <Allowance
        legend={t('voiceSharing.form.daily')}
        hint={t('voiceSharing.form.dailyHint')}
        presets={DAILY}
        value={value.dailyPerReader}
        allowNone
        noneLabel={t('voiceSharing.form.noLimit')}
        format={n}
        chapters={(c) => chaptersHint(c, t)}
        onPick={(dailyPerReader) => set({ dailyPerReader })}
      />
    </div>
  );
}

function Allowance({
  legend,
  hint,
  presets,
  value,
  allowNone,
  noneLabel,
  format,
  chapters,
  onPick,
}: {
  legend: string;
  hint: string;
  presets: number[];
  value: number | undefined;
  allowNone: boolean;
  noneLabel: string;
  format: (n: number) => string;
  chapters: (chars: number) => string;
  onPick: (v: number | undefined) => void;
}) {
  // A value set elsewhere (another device, an older app) that is not a preset
  // is shown as one, rather than silently replaced.
  const options = value !== undefined && !presets.includes(value) ? [...presets, value].sort((a, b) => a - b) : presets;
  return (
    <fieldset>
      <legend className="text-sm text-ink">{legend}</legend>
      <p className="text-[11px] text-ink-muted mb-2 leading-snug">{hint}</p>
      <div className="flex flex-wrap gap-1.5">
        {allowNone && (
          <Chip active={value === undefined} onClick={() => onPick(undefined)}>
            {noneLabel}
          </Chip>
        )}
        {options.map((chars) => (
          <Chip key={chars} active={value === chars} onClick={() => onPick(chars)}>
            {format(chars)}
          </Chip>
        ))}
      </div>
      {value !== undefined && <p className="mt-1.5 text-[11px] text-ink-muted">{chapters(value)}</p>}
    </fieldset>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={clsx(
        'px-3 py-1.5 rounded-full text-xs tabular-nums transition-colors',
        active ? 'bg-brand text-on-brand' : 'bg-surface-raised/70 text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
