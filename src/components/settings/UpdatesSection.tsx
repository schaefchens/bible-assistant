import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyUpdate, checkForUpdates, useUpdateStore } from '@/lib/pwaUpdate';

/** Settings tile showing the running build (commit + date) and a button to
 * check for a PWA update; auto-applies one if found. */
export function UpdatesSection() {
  const { t, i18n } = useTranslation();
  const needRefresh = useUpdateStore((s) => s.needRefresh);
  const [status, setStatus] = useState<'idle' | 'checking' | 'upToDate' | 'found'>(
    'idle',
  );

  const buildDate = (() => {
    try {
      return new Date(__BUILD_TIME__).toLocaleString(i18n.language || undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return __BUILD_TIME__;
    }
  })();

  const onCheck = async () => {
    setStatus('checking');
    await checkForUpdates();
    // Give the SW a brief moment to dispatch `onNeedRefresh` if a new version
    // was found.
    await new Promise((r) => setTimeout(r, 1200));
    if (useUpdateStore.getState().needRefresh) {
      setStatus('found');
      await new Promise((r) => setTimeout(r, 600));
      void applyUpdate();
    } else {
      setStatus('upToDate');
      window.setTimeout(() => setStatus('idle'), 2500);
    }
  };

  const label =
    status === 'checking'
      ? t('settings.updates.checking')
      : status === 'upToDate'
        ? t('settings.updates.upToDate')
        : status === 'found' || needRefresh
          ? t('settings.updates.found')
          : t('settings.updates.check');

  return (
    <div className="space-y-3">
      <p className="text-xs text-cream-dim font-mono">
        {t('settings.updates.version', {
          commit: __GIT_COMMIT__,
          date: buildDate,
        })}
      </p>
      <button
        type="button"
        className="btn-ghost text-xs"
        onClick={() => void onCheck()}
        disabled={status === 'checking' || status === 'found'}
      >
        {label}
      </button>
    </div>
  );
}
