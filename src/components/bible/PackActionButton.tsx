import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { Translation } from '@/services/bible/bibleApi';
import {
  packSizeLabel,
  useBiblePacksStore,
  type PackStatus,
} from '@/store/biblePacksStore';

/** Circular progress ring; doubles as the cancel target while downloading. */
function ProgressRing({ pct }: { pct: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 -rotate-90" aria-hidden="true">
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

/**
 * Trailing control for one row of the translation list: download, resume,
 * cancel, or delete an offline Bible.
 *
 * Rendered for every translation so the row layout stays uniform; bundled
 * texts just show an "Included" chip.
 */
export function PackActionButton({ code }: { code: Translation }) {
  const { t } = useTranslation();
  const status: PackStatus = useBiblePacksStore((s) => s.status[code] ?? 'missing');
  const progress = useBiblePacksStore((s) => s.progress[code]);
  const manifest = useBiblePacksStore((s) => s.manifest);
  const download = useBiblePacksStore((s) => s.download);
  const cancel = useBiblePacksStore((s) => s.cancel);
  const remove = useBiblePacksStore((s) => s.remove);

  // Same two-tap-with-timeout idiom as DangerZone — deleting a Bible the user
  // pulled over cellular deserves a confirm, but not a modal.
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const id = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirming]);

  // Stop the row's onClick from also selecting the translation.
  const swallow = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    fn();
  };

  if (status === 'bundled') {
    return (
      <span className="shrink-0 self-center text-[10px] uppercase tracking-wide text-brand/70">
        {t('bible.packs.included')}
      </span>
    );
  }

  if (status === 'unavailable') {
    return (
      <span className="shrink-0 self-center text-[10px] uppercase tracking-wide text-ink-muted/50">
        {t('bible.packs.unavailable')}
      </span>
    );
  }

  if (progress) {
    const pct = progress.bytesTotal ? progress.bytesDone / progress.bytesTotal : 0;
    return (
      <button
        type="button"
        onClick={swallow(() => cancel(code))}
        title={t('bible.packs.cancel')}
        aria-label={t('bible.packs.cancel')}
        className="shrink-0 self-center relative grid place-items-center h-8 w-8"
      >
        <ProgressRing pct={pct} />
        <span className="absolute text-[9px] tabular-nums text-ink-muted">
          {Math.round(pct * 100)}
        </span>
      </button>
    );
  }

  if (status === 'installed') {
    return (
      <button
        type="button"
        onClick={swallow(() => (confirming ? void remove(code) : setConfirming(true)))}
        className={clsx(
          'shrink-0 self-center rounded-md px-2 py-1 text-[10px] uppercase tracking-wide transition-colors',
          confirming
            ? 'text-red-400 border border-red-500/40 hover:bg-red-500/10'
            : 'text-emerald-400/80 hover:bg-emerald-500/10',
        )}
      >
        {confirming ? t('bible.packs.deleteConfirm') : t('bible.packs.installed')}
      </button>
    );
  }

  // 'missing' | 'partial'
  const size = packSizeLabel(manifest, code);
  return (
    <button
      type="button"
      onClick={swallow(() => void download(code))}
      className="shrink-0 self-center flex items-center gap-1 rounded-md px-2 py-1 text-[10px] uppercase tracking-wide text-ink-muted hover:text-brand hover:bg-brand/10 transition-colors"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M8 2v8m0 0 3-3m-3 3L5 7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2.5 11.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1" strokeLinecap="round" />
      </svg>
      {status === 'partial' ? t('bible.packs.resume') : size}
    </button>
  );
}
