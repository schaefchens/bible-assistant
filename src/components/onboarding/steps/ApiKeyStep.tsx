import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settingsStore';
import { setOpenAiKey } from '@/services/api/auth';
import { extractErrorDetail } from '@/lib/extractErrorDetail';
import { StepHeading } from './StepHeading';

export function ApiKeyStep() {
  const { t } = useTranslation();
  const hasKey = useSettingsStore((s) => s.hasUserOpenAiKey);
  const masked = useSettingsStore((s) => s.userOpenAiKeyMasked);
  const setStatus = useSettingsStore((s) => s.setUserOpenAiKeyStatus);
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
    } catch (e) {
      setError(extractErrorDetail(e) ?? t('onboarding.wizard.apiKey.invalid'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <StepHeading
        title={t('onboarding.wizard.apiKey.title')}
        subtitle={t('onboarding.wizard.apiKey.subtitle')}
      />
      {hasKey ? (
        <div className="flex items-center justify-between gap-2 bg-navy-soft rounded-xl px-4 py-3">
          <span className="font-mono text-sm text-cream">{masked ?? '••••••'}</span>
          <span className="text-xs text-gold">✓ {t('onboarding.wizard.apiKey.saved')}</span>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            type="password"
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('onboarding.wizard.apiKey.placeholder')}
            className="flex-1 bg-navy-soft text-cream rounded-xl px-3 py-2 font-mono text-sm"
          />
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => void onSave()}
            className="btn-ghost text-xs disabled:opacity-50 whitespace-nowrap"
          >
            {busy
              ? t('onboarding.wizard.apiKey.saving')
              : t('onboarding.wizard.apiKey.save')}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
