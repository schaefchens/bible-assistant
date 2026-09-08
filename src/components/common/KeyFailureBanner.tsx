import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { onUserKeyFailure } from '@/services/api/client';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Mounted at app root. Listens for `user_key_failed` errors surfaced by the
 * API client and offers a one-click opt-in to the shared server key for the
 * rest of the session. The opt-in is transient — reloading the page tries
 * the personal key again.
 */
export function KeyFailureBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const setPreferShared = useSettingsStore((s) => s.setSessionPreferSharedKey);
  const sessionPreferShared = useSettingsStore((s) => s.sessionPreferSharedKey);

  useEffect(() => {
    return onUserKeyFailure(() => {
      // Don't re-prompt if the user already opted in this session.
      if (useSettingsStore.getState().sessionPreferSharedKey) return;
      setVisible(true);
    });
  }, []);

  if (!visible || sessionPreferShared) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 pointer-events-none flex justify-center px-4 pb-4">
      <div className="pointer-events-auto max-w-md w-full bg-surface-raised border border-red-500/40 rounded-2xl p-4 shadow-xl">
        <p className="text-sm text-ink">{t('keyFailure.title')}</p>
        <p className="text-xs text-ink-muted mt-1">{t('keyFailure.hint')}</p>
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              setPreferShared(true);
              setVisible(false);
            }}
          >
            {t('keyFailure.useShared')}
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => setVisible(false)}
          >
            {t('keyFailure.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}
