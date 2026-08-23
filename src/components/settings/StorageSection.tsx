import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clearMediaCache, mediaCacheStats } from '@/lib/mediaCache';
import { narrationCount } from '@/services/narration/narrationIndex';

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

type Usage = { total: number; pinned: number; items: number };

async function readUsage(): Promise<Usage> {
  const [stats, items] = await Promise.all([mediaCacheStats(), narrationCount()]);
  return { ...stats, items };
}

/**
 * What the app is holding on disk, and the one button that gives it back.
 *
 * Worth surfacing now that narration can be downloaded on purpose: pinned audio
 * is exempt from the LRU sweep, so it is the one thing that can grow past the
 * cache budget with nothing able to reclaim it automatically.
 */
export function StorageSection() {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    let alive = true;
    void readUsage().then((u) => {
      if (alive) setUsage(u);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Same two-tap-with-timeout idiom as DangerZone and PackActionButton.
  useEffect(() => {
    if (!confirming) return;
    const id = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirming]);

  const onClear = async () => {
    if (clearing) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setClearing(true);
    await clearMediaCache();
    setUsage(await readUsage());
    setClearing(false);
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-cream-dim">
        {usage
          ? t('settings.storage.summary', {
              total: mb(usage.total),
              downloaded: mb(usage.pinned),
              count: usage.items,
            })
          : t('settings.storage.loading')}
      </p>
      <p className="text-xs text-cream-dim/70">{t('settings.storage.hint')}</p>
      <button
        type="button"
        onClick={() => void onClear()}
        disabled={clearing}
        className="text-sm text-cream-dim hover:text-cream border border-navy-soft rounded-xl px-3 py-2 transition-colors disabled:opacity-60"
      >
        {clearing
          ? t('settings.storage.clearing')
          : confirming
            ? t('settings.storage.clearConfirm')
            : t('settings.storage.clear')}
      </button>
    </div>
  );
}
