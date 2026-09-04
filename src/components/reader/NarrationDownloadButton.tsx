import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  effectiveReadingVoice,
  effectiveVoiceStyle,
  useSettingsStore,
} from '@/store/settingsStore';
import {
  narrationTargetKey,
  useNarrationStore,
  type NarrationSubject,
} from '@/store/narrationStore';
import { isBrowserVoice, type OpenAiVoiceId } from '@/types/domain';

type Props = { subject: NarrationSubject };

/**
 * Download this chapter's — or this post's — narration for offline listening.
 *
 * One component for both, because the whole interaction is identical: a
 * progress ring that doubles as cancel, a tick that two-taps into a trash, and
 * a coverage check whenever the voice changes. Only the subject differs, and
 * `narrationStore` already takes a union.
 *
 * Hidden on the device voice: that engine speaks from the text, which is already
 * offline, so there is nothing to fetch and offering it would imply otherwise.
 */
export function NarrationDownloadButton({ subject }: Props) {
  const { t } = useTranslation();
  // Subscribed, not just read once: switching voice changes which narration this
  // button is even talking about.
  const voiceSetting = useSettingsStore((s) => s.voice);
  const readingVoice = effectiveReadingVoice();
  const voiceStyle = effectiveVoiceStyle();

  const check = useNarrationStore((s) => s.check);
  const download = useNarrationStore((s) => s.download);
  const cancel = useNarrationStore((s) => s.cancel);
  const remove = useNarrationStore((s) => s.remove);

  // Same two-tap-with-timeout idiom as PackActionButton and DangerZone: giving
  // back a chapter someone waited to generate deserves a confirm, not a modal.
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  useEffect(() => {
    if (!confirmingRemove) return;
    const id = window.setTimeout(() => setConfirmingRemove(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirmingRemove]);

  const usesDeviceVoice = isBrowserVoice(readingVoice);
  const voice = readingVoice as OpenAiVoiceId;
  const target = { ...subject, voice, voiceStyle };
  const key = narrationTargetKey(target);
  const status = useNarrationStore((s) => s.status[key]) ?? 'unknown';
  const progress = useNarrationStore((s) => s.progress[key]);

  useEffect(() => {
    if (usesDeviceVoice) return;
    void check(target).catch(() => {});
    // `target` is rebuilt every render, so the key it produces is the real
    // dependency — it changes exactly when the subject or the voice does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check, usesDeviceVoice, key, voiceSetting]);

  if (usesDeviceVoice) return null;

  const pct = progress && progress.total > 0 ? progress.done / progress.total : 0;

  if (status === 'downloading') {
    return (
      <button
        type="button"
        onClick={() => cancel(target)}
        aria-label={t('read.narration.cancel') as string}
        title={t('read.narration.cancel') as string}
        className="h-8 w-8 rounded-lg flex items-center justify-center text-brand"
      >
        <ProgressRing pct={pct} />
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
          void remove(target);
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
        className={clsx(
          'h-8 w-8 rounded-lg flex items-center justify-center transition-all active:scale-95',
          confirmingRemove ? 'text-red-400 bg-red-500/10' : 'text-brand',
        )}
      >
        {confirmingRemove ? <TrashIcon /> : <CheckIcon />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void download(target)}
      aria-label={t('read.narration.download') as string}
      title={
        status === 'partial'
          ? (t('read.narration.resume') as string)
          : (t('read.narration.download') as string)
      }
      className={clsx(
        'h-8 w-8 rounded-lg flex items-center justify-center transition-all active:scale-95',
        status === 'partial' ? 'text-brand-muted hover:text-brand' : 'text-ink-muted hover:text-ink',
      )}
    >
      <DownloadIcon />
    </button>
  );
}

/** Circular progress ring; doubles as the cancel target while downloading.
 * Shared with `NarrationGroupButton` — the two controls sit one above the
 * other, so a second set of glyphs would read as a second feature. */
export function ProgressRing({ pct }: { pct: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 -rotate-90" aria-hidden="true">
      <circle cx="12" cy="12" r={r} fill="none" strokeWidth="2.5" className="stroke-surface-raised" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="stroke-brand"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
      />
    </svg>
  );
}

export function DownloadIcon() {
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
      <path d="M12 3v11" />
      <polyline points="8 11 12 15 16 11" />
      <path d="M5 19h14" />
    </svg>
  );
}

export function TrashIcon() {
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
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
