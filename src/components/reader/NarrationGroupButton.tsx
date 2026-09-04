import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  CheckIcon,
  DownloadIcon,
  ProgressRing,
  RetryIcon,
  TrashIcon,
} from './NarrationDownloadButton';
import {
  cancelNarrationGroup,
  checkNarrationGroup,
  downloadNarrationGroup,
  groupFraction,
  groupInstalledCount,
  groupStatus,
  narrationGroupKey,
  narrationTargetsFor,
  removeNarrationGroup,
} from '@/lib/narrationGroup';
import {
  narrationTargetKey,
  useNarrationStore,
  type NarrationSubject,
} from '@/store/narrationStore';
import {
  effectiveReadingVoice,
  effectiveVoiceStyle,
  useSettingsStore,
} from '@/store/settingsStore';
import { isBrowserVoice, type OpenAiVoiceId } from '@/types/domain';

type Props = {
  /**
   * What this covers — a day of a plan, a page of a list, a room's pieces,
   * everything unread. Mixed kinds are fine; `narrationStore` takes both.
   */
  subjects: NarrationSubject[];
  /** What it offers: "download this day", "download these pieces". */
  label: string;
  /**
   * Icon-only, for a place that already names what it covers — beside the
   * "everything new" pill, where the pill is the label and a second one would
   * just be longer.
   */
  compact?: boolean;
};

/**
 * Download a whole run of things — a day of a reading plan, a room's pieces,
 * everything you haven't read — in one tap.
 *
 * The sibling of `NarrationDownloadButton` and deliberately not a variant of
 * it: that one owns a single target's status, and this one owns none at all.
 * It reads the same per-item entries out of `narrationStore` that the rows
 * beneath it show, so the two can't disagree, something already downloaded on
 * its own counts toward its group, and the rows tick over one by one as the run
 * works through them.
 *
 * Labelled rather than icon-only where it heads a list, unlike the per-row
 * buttons: the thing a reader needs to know there is *scope*, and one more bare
 * glyph in a column of them would say nothing about how much it takes with it.
 */
export function NarrationGroupButton({ subjects, label, compact = false }: Props) {
  const { t } = useTranslation();
  // Subscribed, not read once: switching voice changes which narration this
  // button is even talking about.
  const voiceSetting = useSettingsStore((s) => s.voice);
  const readingVoice = effectiveReadingVoice();
  const voiceStyle = effectiveVoiceStyle();
  const usesDeviceVoice = isBrowserVoice(readingVoice);
  const voice = readingVoice as OpenAiVoiceId;

  // `subjects` is rebuilt on every render of the sheet, so the group's own key
  // is the real dependency — it changes exactly when the items or the voice do,
  // and it is the identity the run map is keyed by anyway.
  const built = narrationTargetsFor(subjects, voice, voiceStyle);
  const groupKey = narrationGroupKey(built);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const targets = useMemo(() => built, [groupKey, voiceSetting]);
  const keys = useMemo(() => targets.map(narrationTargetKey), [targets]);

  // Aggregates, each a primitive: the per-item progress ticks write to this
  // store, and a selector returning an object would re-render the whole sheet
  // on every one of them.
  const status = useNarrationStore((s) => groupStatus(s.status, keys));
  const fraction = useNarrationStore((s) => groupFraction(s.status, s.progress, keys));
  const installed = useNarrationStore((s) => groupInstalledCount(s.status, keys));
  // A run that ended early — two failures in a row, which is the backend or the
  // network being gone. Also a primitive, for the reason above: the per-item
  // ticks write to this store, so an array of messages would re-render the
  // sheet on each one. See `NarrationDownloadButton` for why this is shown at
  // all; a group is where the silence was worst, because ending after two of
  // thirty chapters looked exactly like finishing.
  const anyFailed = useNarrationStore((s) => keys.some((k) => !!s.error[k]));

  // Same two-tap-with-timeout idiom as NarrationDownloadButton: giving back a
  // day someone waited to generate deserves a confirm, not a modal.
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  useEffect(() => {
    if (!confirmingRemove) return;
    const id = window.setTimeout(() => setConfirmingRemove(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirmingRemove]);

  useEffect(() => {
    if (usesDeviceVoice) return;
    void checkNarrationGroup(targets);
  }, [targets, usesDeviceVoice]);

  // Hidden on the device voice for the same reason as the single button: that
  // engine speaks from the text, which is already offline.
  //
  // Hidden for a single item too — that row's own button already *is* this
  // button, and two of them a row apart only invites the question of how they
  // differ.
  if (usesDeviceVoice || targets.length < 2) return null;

  const base = compact
    ? 'h-8 w-8 shrink-0 rounded-lg flex items-center justify-center transition-all active:scale-95'
    : 'h-7 shrink-0 pl-1.5 pr-2 rounded-lg flex items-center gap-1.5 text-[11px] transition-all active:scale-95';

  if (status === 'downloading') {
    return (
      <button
        type="button"
        onClick={() => cancelNarrationGroup(targets)}
        aria-label={t('read.narration.cancel') as string}
        title={t('read.narration.cancel') as string}
        className={clsx(base, 'text-brand')}
      >
        <ProgressRing pct={fraction} />
        {!compact &&
          t('read.narration.groupProgress', { done: installed, total: targets.length })}
      </button>
    );
  }

  if (status === 'installed') {
    return (
      <button
        type="button"
        onClick={() => {
          if (!confirmingRemove) {
            setConfirmingRemove(true);
            return;
          }
          setConfirmingRemove(false);
          void removeNarrationGroup(targets);
        }}
        aria-label={
          (confirmingRemove
            ? t('read.narration.removeConfirm')
            : t('read.narration.downloaded')) as string
        }
        title={
          (confirmingRemove
            ? t('read.narration.removeConfirm')
            : t('read.narration.downloaded')) as string
        }
        className={clsx(base, confirmingRemove ? 'text-red-400 bg-red-500/10' : 'text-brand')}
      >
        {confirmingRemove ? <TrashIcon /> : <CheckIcon />}
        {!compact &&
          (confirmingRemove
            ? t('read.narration.groupRemove')
            : t('read.narration.groupDownloaded'))}
      </button>
    );
  }

  // A failed run still says how far it got, since "3/30" plus "carry on" is the
  // whole state: what to expect offline, and that tapping resumes rather than
  // restarts. Offline gets its own wording — there is nothing to retry yet.
  const failedLabel = (
    navigator.onLine === false ? t('read.narration.failedOffline') : t('read.narration.groupFailed')
  ) as string;

  return (
    <button
      type="button"
      onClick={() => void downloadNarrationGroup(targets)}
      aria-label={anyFailed ? failedLabel : label}
      title={anyFailed ? failedLabel : label}
      className={clsx(
        base,
        anyFailed
          ? 'text-amber-500 hover:text-amber-400'
          : status === 'partial'
            ? 'text-brand-muted hover:text-brand'
            : 'text-ink-muted hover:text-ink',
      )}
    >
      {anyFailed ? <RetryIcon /> : <DownloadIcon />}
      {!compact &&
        (anyFailed || status === 'partial'
          ? t('read.narration.groupResume', { done: installed, total: targets.length })
          : label)}
    </button>
  );
}
