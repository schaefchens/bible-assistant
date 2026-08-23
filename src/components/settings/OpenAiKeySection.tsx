import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settingsStore';
import { extractErrorDetail } from '@/lib/extractErrorDetail';
import { clearOpenAiKey, setOpenAiKey } from '@/services/api/auth';

/** Settings tile for the user's personal OpenAI key: enter/validate/save,
 * remove, and (when a key is set but the shared key is in use this session)
 * a "retry with mine" affordance. */
export function OpenAiKeySection() {
  const { t } = useTranslation();
  const hasKey = useSettingsStore((s) => s.hasUserOpenAiKey);
  const masked = useSettingsStore((s) => s.userOpenAiKeyMasked);
  const sessionPreferShared = useSettingsStore((s) => s.sessionPreferSharedKey);
  const setStatus = useSettingsStore((s) => s.setUserOpenAiKeyStatus);
  const setPreferShared = useSettingsStore((s) => s.setSessionPreferSharedKey);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSave = async () => {
    const key = draft.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await setOpenAiKey(key);
      setStatus(!!resp.hasKey, resp.masked ?? null);
      setDraft('');
      // A freshly-validated key cancels any prior shared-key opt-in.
      if (sessionPreferShared) setPreferShared(false);
    } catch (e) {
      setError(extractErrorDetail(e) ?? t('settings.openaiKey.invalid'));
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    setBusy(true);
    setError(null);
    try {
      await clearOpenAiKey();
      setStatus(false, null);
    } catch (e) {
      setError(extractErrorDetail(e) ?? 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">{t('settings.openaiKey.hint')}</p>
      {hasKey ? (
        <>
          <div className="flex items-center justify-between gap-2 bg-surface-raised rounded-xl px-3 py-2">
            <span className="font-mono text-sm text-ink">{masked ?? '••••••'}</span>
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={busy}
              onClick={() => void onClear()}
            >
              {t('settings.openaiKey.remove')}
            </button>
          </div>
          {sessionPreferShared && (
            <p className="text-xs text-red-400">
              {t('settings.openaiKey.usingSharedThisSession')}{' '}
              <button
                type="button"
                className="underline"
                onClick={() => setPreferShared(false)}
              >
                {t('settings.openaiKey.retryWithMine')}
              </button>
            </p>
          )}
        </>
      ) : (
        <div className="flex gap-2">
          <input
            type="password"
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="sk-..."
            className="flex-1 bg-surface-raised text-ink rounded-xl px-3 py-2 font-mono text-sm"
          />
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => void onSave()}
            className="btn-ghost text-xs disabled:opacity-50"
          >
            {busy ? t('settings.openaiKey.saving') : t('settings.openaiKey.save')}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
