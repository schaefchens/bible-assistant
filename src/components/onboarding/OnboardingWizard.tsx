import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useSettingsStore } from '@/store/settingsStore';
import { WelcomeStep } from './steps/WelcomeStep';
import { LanguageStep } from './steps/LanguageStep';
import { TranslationStep } from './steps/TranslationStep';
import { AnnouncementsStep } from './steps/AnnouncementsStep';
import { PausesStep } from './steps/PausesStep';
import { ApiKeyStep } from './steps/ApiKeyStep';
import { VoicesStep } from './steps/VoicesStep';
import { SyncStep } from './steps/SyncStep';
import { RecoverPassphrase } from './RecoverPassphrase';

type Step =
  | 'welcome'
  | 'language'
  | 'translation'
  | 'announcements'
  | 'pauses'
  | 'apiKey'
  | 'voices'
  | 'sync';

/**
 * Order matters: everything that works with no network comes first, and the two
 * steps that need one — the assistant key and server sync — come last, framed as
 * optional. The old wizard opened on an account-creation screen, which made a
 * fully-offline app feel like it needed a server before it would read anything.
 *
 * The ambient-music step is gone: it fetches ambient.list, so it was the one
 * step that could simply fail on a first run in airplane mode, and ambient is
 * off by default anyway. It lives in Settings.
 */
const BASE_STEPS: Step[] = [
  'welcome',
  'language',
  'translation',
  'announcements',
  'pauses',
  'apiKey',
];

export function OnboardingWizard({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('welcome');
  // Restoring from a passphrase replaces the whole wizard: it pulls an existing
  // library, settings included, so walking someone through choosing them first
  // would be asking questions it's about to overwrite the answers to.
  const [recovering, setRecovering] = useState(false);
  const hasUserOpenAiKey = useSettingsStore((s) => s.hasUserOpenAiKey);

  // Voices step only exists once the user has saved a valid personal key,
  // so existing wizard navigation just grows by one screen if/when they do.
  const steps = useMemo<Step[]>(
    () => (hasUserOpenAiKey ? [...BASE_STEPS, 'voices', 'sync'] : [...BASE_STEPS, 'sync']),
    [hasUserOpenAiKey],
  );
  const idx = Math.max(0, steps.indexOf(step));
  const isLast = idx === steps.length - 1;

  // Seed wizard-preferred defaults on first paint — but only when the user
  // hasn't already nudged them away from the factory values, so a returning
  // visitor (e.g. via "Wipe all data" then re-onboarding) doesn't get their
  // earlier choices stomped before they reach the relevant step.
  useEffect(() => {
    const s = useSettingsStore.getState();
    if (!s.readChapterHeadings) s.setReadChapterHeadings(true);
    if (s.pauseBetweenVersesMs === 0) s.setPauseBetweenVersesMs(200);
    if (s.pauseBetweenChaptersMs === 0) s.setPauseBetweenChaptersMs(5000);
  }, []);

  const next = () => {
    if (isLast) onDone();
    else setStep(steps[idx + 1]);
  };
  const back = () => {
    if (idx > 0) setStep(steps[idx - 1]);
  };

  if (recovering) {
    return (
      <div className="flex flex-col h-full pt-safe pb-safe px-safe bg-navy text-cream">
        <div className="flex-1 overflow-y-auto px-6 py-8 flex flex-col">
          <RecoverPassphrase onDone={onDone} onBack={() => setRecovering(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full pt-safe pb-safe bg-navy text-cream">
      <div className="flex-1 min-h-0 px-6 py-6 flex flex-col">
        <div className="max-w-md mx-auto w-full flex flex-col flex-1 min-h-0">
          <header className="flex items-center justify-between gap-4 mb-8">
            <Progress idx={idx} total={steps.length} />
            {step !== 'welcome' && (
              <button
                type="button"
                onClick={onDone}
                className="text-xs text-cream-dim hover:text-cream whitespace-nowrap"
              >
                {t('onboarding.wizard.skip')} →
              </button>
            )}
          </header>

          <div className="flex-1 min-h-0 flex flex-col justify-center">
            {step === 'welcome' && <WelcomeStep onRestore={() => setRecovering(true)} />}
            {step === 'language' && <LanguageStep />}
            {step === 'translation' && <TranslationStep />}
            {step === 'announcements' && <AnnouncementsStep />}
            {step === 'pauses' && <PausesStep />}
            {step === 'apiKey' && <ApiKeyStep />}
            {step === 'voices' && <VoicesStep />}
            {step === 'sync' && <SyncStep />}
          </div>

          <footer className="flex items-center justify-between gap-3 mt-10">
            {idx > 0 ? (
              <button
                type="button"
                onClick={back}
                className="btn-ghost px-4 py-3"
              >
                ← {t('onboarding.wizard.back')}
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={next}
              className="btn-primary px-6 py-3 flex-1 max-w-[12rem]"
            >
              {isLast
                ? t('onboarding.wizard.done')
                : step === 'welcome'
                  ? t('onboarding.wizard.welcome.start')
                  : t('onboarding.wizard.continue')}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}

function Progress({ idx, total }: { idx: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={clsx(
            'h-1.5 rounded-full transition-all',
            i === idx ? 'w-8 bg-gold' : i < idx ? 'w-6 bg-gold/60' : 'w-6 bg-navy-soft',
          )}
        />
      ))}
    </div>
  );
}
