import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { onUserKeyFailure } from '@/services/api/client';
import { useSettingsStore } from '@/store/settingsStore';
import { ROUTES } from '@/lib/appRoutes';
import type { ElevenLabsFailure } from '@/services/voices/voiceProfiles';

/**
 * Mounted at app root: tells the user when a key of theirs stopped working.
 *
 * Two cases in one banner, because they occupy the same corner of the screen
 * and would otherwise stack on top of each other:
 *
 * - **OpenAI** (`user_key_failed`): offers a one-click opt-in to the shared
 *   server key for the rest of the session. Transient — reloading the page
 *   tries the personal key again.
 * - **ElevenLabs** (`settings.elevenLabsFailure`, recorded by
 *   lib/providerFailureWatch.ts): no decision to make — narration has already
 *   fallen back to the system voice — so it explains why and offers the way to
 *   fix it. Shown once per distinct failure; dismissing it hides that one.
 */
export function KeyFailureBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [openAiVisible, setOpenAiVisible] = useState(false);
  const setPreferShared = useSettingsStore((s) => s.setSessionPreferSharedKey);
  const sessionPreferShared = useSettingsStore((s) => s.sessionPreferSharedKey);
  const elevenLabsFailure = useSettingsStore((s) => s.elevenLabsFailure);
  const [dismissed, setDismissed] = useState<ElevenLabsFailure | null>(null);

  useEffect(() => {
    return onUserKeyFailure(() => {
      // Don't re-prompt if the user already opted in this session.
      if (useSettingsStore.getState().sessionPreferSharedKey) return;
      setOpenAiVisible(true);
    });
  }, []);

  if (openAiVisible && !sessionPreferShared) {
    return (
      <Banner>
        <p className="text-sm text-ink">{t('keyFailure.title')}</p>
        <p className="text-xs text-ink-muted mt-1">{t('keyFailure.hint')}</p>
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              setPreferShared(true);
              setOpenAiVisible(false);
            }}
          >
            {t('keyFailure.useShared')}
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={() => setOpenAiVisible(false)}>
            {t('keyFailure.dismiss')}
          </button>
        </div>
      </Banner>
    );
  }

  // A failure object is replaced, never mutated, so identity is "this one".
  if (elevenLabsFailure && elevenLabsFailure !== dismissed) {
    return (
      <Banner>
        <p className="text-sm text-ink">
          {elevenLabsFailure.kind === 'quota'
            ? t('narrationVoices.failure.quota')
            : elevenLabsFailure.kind === 'key'
              ? t('narrationVoices.failure.key')
              : t('narrationVoices.failure.voice')}
        </p>
        <p className="text-xs text-ink-muted mt-1">{t('narrationVoices.failure.fellBack')}</p>
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              setDismissed(elevenLabsFailure);
              navigate(`${ROUTES.voices}?focus=providers`);
            }}
          >
            {t('narrationVoices.failure.open')}
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={() => setDismissed(elevenLabsFailure)}>
            {t('keyFailure.dismiss')}
          </button>
        </div>
      </Banner>
    );
  }

  return null;
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 pointer-events-none flex justify-center px-4 pb-4">
      <div
        role="status"
        className="pointer-events-auto max-w-md w-full bg-surface-raised border border-red-500/40 rounded-2xl p-4 shadow-xl"
      >
        {children}
      </div>
    </div>
  );
}
