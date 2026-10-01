import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settingsStore';
import { useLocale } from '@/hooks/useLocale';
import {
  clearElevenLabsKey,
  setElevenLabsKey,
  type ElevenLabsSubscription,
} from '@/services/api/auth';
import { getElevenLabsSubscription } from '@/services/api/elevenlabs';
import { ProviderKeySection } from './ProviderKeySection';

const KEYS_URL = 'https://elevenlabs.io/app/settings/api-keys';

/**
 * The user's ElevenLabs key, and what is left on their account.
 *
 * Credits are worth showing because every ElevenLabs narration is billed to
 * the user's own plan — a chapter is a few thousand credits, and a free tier
 * holds about three. They are fetched when this card mounts (never at boot:
 * `status` is a file check, `subscription` calls ElevenLabs), and a key without
 * the "user read" permission simply can't show them.
 */
export function ElevenLabsKeySection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const hasKey = useSettingsStore((s) => s.hasUserElevenLabsKey);
  const masked = useSettingsStore((s) => s.userElevenLabsKeyMasked);
  const failure = useSettingsStore((s) => s.elevenLabsFailure);
  const setStatus = useSettingsStore((s) => s.setUserElevenLabsKeyStatus);
  const setFailure = useSettingsStore((s) => s.setElevenLabsFailure);
  /** Keyed by the masked key it belongs to, so a new key never shows the old
   * one's numbers — and a key change needs no effect to clear them. */
  const [credits, setCredits] = useState<{
    key: string;
    subscription: ElevenLabsSubscription | null;
  } | null>(null);

  useEffect(() => {
    if (!hasKey || !masked) return;
    let cancelled = false;
    void getElevenLabsSubscription()
      .then((r) => {
        if (!cancelled) setCredits({ key: masked, subscription: r.subscription });
      })
      .catch(() => {
        if (!cancelled) setCredits({ key: masked, subscription: null });
      });
    return () => {
      cancelled = true;
    };
  }, [hasKey, masked]);

  const shown = hasKey && credits?.key === masked ? credits : null;
  const fmt = (n: number) => n.toLocaleString(locale);

  return (
    <ProviderKeySection
      title={t('narrationVoices.keys.elevenLabsTitle')}
      hint={
        <>
          {t('narrationVoices.keys.elevenLabsHint')}{' '}
          <a href={KEYS_URL} target="_blank" rel="noopener noreferrer" className="text-brand underline">
            {t('narrationVoices.keys.elevenLabsGetKey')}
          </a>
        </>
      }
      placeholder="sk_..."
      hasKey={hasKey}
      masked={masked}
      invalidMessage={t('narrationVoices.keys.elevenLabsInvalid')}
      onSave={async (key) => {
        const resp = await setElevenLabsKey(key);
        setStatus(!!resp.hasKey, resp.masked ?? null);
        // A key that just validated answers whatever refused the last one.
        setFailure(null);
        if (resp.masked) setCredits({ key: resp.masked, subscription: resp.subscription ?? null });
      }}
      onClear={async () => {
        await clearElevenLabsKey();
        setStatus(false, null);
      }}
    >
      {shown?.subscription && (
        <div className="space-y-1">
          <div className="h-1.5 rounded-full bg-surface overflow-hidden" aria-hidden="true">
            <div
              className="h-full bg-brand"
              style={{
                width: `${Math.min(
                  100,
                  (shown.subscription.characterCount / Math.max(1, shown.subscription.characterLimit)) * 100,
                )}%`,
              }}
            />
          </div>
          <p className="text-xs text-ink-muted">
            {t('narrationVoices.keys.credits', {
              used: fmt(shown.subscription.characterCount),
              limit: fmt(shown.subscription.characterLimit),
            })}
            {shown.subscription.resetsAt
              ? ` · ${t('narrationVoices.keys.resets', {
                  date: new Date(shown.subscription.resetsAt).toLocaleDateString(locale, {
                    day: 'numeric',
                    month: 'short',
                  }),
                })}`
              : ''}
          </p>
        </div>
      )}
      {shown && !shown.subscription && (
        <p className="text-xs text-ink-muted">{t('narrationVoices.keys.creditsHidden')}</p>
      )}
      {hasKey && failure && (
        <p className="text-xs text-red-400">
          {failure.kind === 'quota'
            ? t('narrationVoices.failure.quota')
            : failure.kind === 'key'
              ? t('narrationVoices.failure.key')
              : t('narrationVoices.failure.voice')}{' '}
          <button type="button" className="underline" onClick={() => setFailure(null)}>
            {t('narrationVoices.failure.retry')}
          </button>
        </p>
      )}
    </ProviderKeySection>
  );
}
