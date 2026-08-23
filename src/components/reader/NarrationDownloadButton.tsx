import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { Translation } from '@/services/bible/bibleApi';
import {
  effectiveReadingVoice,
  effectiveVoiceStyle,
  useSettingsStore,
} from '@/store/settingsStore';
import { useNarrationStore } from '@/store/narrationStore';
import { chapterNarrationKey } from '@/services/narration/downloadChapter';
import { isBrowserVoice, type OpenAiVoiceId } from '@/types/domain';

type Props = {
  translation: Translation;
  bookId: number;
  chapter: number;
};

/**
 * Download this chapter's narration for offline listening.
 *
 * Hidden on the device voice: that engine speaks from the text, which is already
 * offline, so there is nothing to fetch and offering it would imply otherwise.
 */
export function NarrationDownloadButton({ translation, bookId, chapter }: Props) {
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
  const key = chapterNarrationKey(voice, translation, bookId, chapter);
  const status = useNarrationStore((s) => s.status[key]) ?? 'unknown';
  const progress = useNarrationStore((s) => s.progress[key]);

  const target = { voice, voiceStyle, translation, bookId, chapter };

  useEffect(() => {
    if (usesDeviceVoice) return;
    void check(target).catch(() => {});
    // `target` is rebuilt every render; the primitives it's made of are the
    // real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check, usesDeviceVoice, voice, voiceStyle, translation, bookId, chapter, voiceSetting]);

  if (usesDeviceVoice) return null;

  const pct = progress && progress.total > 0 ? progress.done / progress.total : 0;

  if (status === 'downloading') {
    return (
      <button
        type="button"
        onClick={() => cancel(target)}
        aria-label={t('read.narration.cancel') as string}
        title={t('read.narration.cancel') as string}
        className="h-8 w-8 rounded-lg flex items-center justify-center text-gold"
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
          confirmingRemove ? 'text-red-400 bg-red-500/10' : 'text-gold',
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
        status === 'partial' ? 'text-gold-dim hover:text-gold' : 'text-cream-dim hover:text-cream',
      )}
    >
      <DownloadIcon />
    </button>
  );
}

/** Circular progress ring; doubles as the cancel target while downloading. */
function ProgressRing({ pct }: { pct: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 -rotate-90" aria-hidden="true">
      <circle cx="12" cy="12" r={r} fill="none" strokeWidth="2.5" className="stroke-navy-soft" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="stroke-gold"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
      />
    </svg>
  );
}

function DownloadIcon() {
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

function TrashIcon() {
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

function CheckIcon() {
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
