import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settingsStore';
import { clearOpenAiKey, setOpenAiKey } from '@/services/api/auth';
import { ProviderKeySection } from '@/components/voiceProfiles/ProviderKeySection';

/** The user's personal OpenAI key: enter/validate/save, remove, and (when a
 * key is set but the shared key is in use this session) a "retry with mine"
 * affordance. It pays for more than narration — chat and speech recognition
 * too — which the hint says, since this card lives on the voices screen. */
export function OpenAiKeySection() {
  const { t } = useTranslation();
  const hasKey = useSettingsStore((s) => s.hasUserOpenAiKey);
  const masked = useSettingsStore((s) => s.userOpenAiKeyMasked);
  const sessionPreferShared = useSettingsStore((s) => s.sessionPreferSharedKey);
  const setStatus = useSettingsStore((s) => s.setUserOpenAiKeyStatus);
  const setPreferShared = useSettingsStore((s) => s.setSessionPreferSharedKey);

  return (
    <ProviderKeySection
      title={t('settings.openaiKey.title')}
      hint={t('settings.openaiKey.hint')}
      placeholder="sk-..."
      hasKey={hasKey}
      masked={masked}
      invalidMessage={t('settings.openaiKey.invalid')}
      onSave={async (key) => {
        const resp = await setOpenAiKey(key);
        setStatus(!!resp.hasKey, resp.masked ?? null);
        // A freshly-validated key cancels any prior shared-key opt-in.
        if (sessionPreferShared) setPreferShared(false);
      }}
      onClear={async () => {
        await clearOpenAiKey();
        setStatus(false, null);
      }}
    >
      {hasKey && sessionPreferShared && (
        <p className="text-xs text-red-400">
          {t('settings.openaiKey.usingSharedThisSession')}{' '}
          <button type="button" className="underline" onClick={() => setPreferShared(false)}>
            {t('settings.openaiKey.retryWithMine')}
          </button>
        </p>
      )}
    </ProviderKeySection>
  );
}
