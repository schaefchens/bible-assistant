import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { applyUpdate, checkForUpdates, useUpdateStore } from '@/lib/pwaUpdate';

/** Settings tile showing the running build (commit + date) and — on the web
 * build only — a button to check for a PWA update, auto-applying one if found.
 *
 * There is no service worker in the native builds, so `checkForUpdates()` is a
 * silent no-op there and the button would always claim "up to date". The build
 * stamp stays on both: when you're sideloading APKs, "which build is this?" is
 * exactly the question you need answered. */
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
      {Capacitor.isNativePlatform() ? (
        <p className="text-xs text-cream-dim">{t('settings.updates.nativeHint')}</p>
      ) : (
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => void onCheck()}
          disabled={status === 'checking' || status === 'found'}
        >
          {label}
        </button>
      )}
    </div>
  );
}
