import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useSettingsStore } from '@/store/settingsStore';
import { LanguageStep } from './steps/LanguageStep';
import { TranslationStep } from './steps/TranslationStep';
import { MusicStep } from './steps/MusicStep';
import { AnnouncementsStep } from './steps/AnnouncementsStep';
import { PausesStep } from './steps/PausesStep';
import { ApiKeyStep } from './steps/ApiKeyStep';
import { VoicesStep } from './steps/VoicesStep';

type Step =
  | 'language'
  | 'translation'
  | 'music'
  | 'announcements'
  | 'pauses'
  | 'apiKey'
  | 'voices';

const BASE_STEPS: Step[] = [
  'language',
  'translation',
  'music',
  'announcements',
  'pauses',
  'apiKey',
];

export function OnboardingWizard({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('language');
  const hasUserOpenAiKey = useSettingsStore((s) => s.hasUserOpenAiKey);

  // Voices step only exists once the user has saved a valid personal key,
  // so existing wizard navigation just grows by one screen if/when they do.
  const steps = useMemo<Step[]>(
    () => (hasUserOpenAiKey ? [...BASE_STEPS, 'voices'] : BASE_STEPS),
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

  return (
    <div className="flex flex-col h-full pt-safe pb-safe bg-navy text-cream">
      <div className="flex-1 min-h-0 px-6 py-6 flex flex-col">
        <div className="max-w-md mx-auto w-full flex flex-col flex-1 min-h-0">
          <header className="flex items-center justify-between gap-4 mb-8">
            <Progress idx={idx} total={steps.length} />
            <button
              type="button"
              onClick={onDone}
              className="text-xs text-cream-dim hover:text-cream whitespace-nowrap"
            >
              {t('onboarding.wizard.skip')} →
            </button>
          </header>

          <div className="flex-1 min-h-0 flex flex-col justify-center">
            {step === 'language' && <LanguageStep />}
            {step === 'translation' && <TranslationStep />}
            {step === 'music' && <MusicStep />}
            {step === 'announcements' && <AnnouncementsStep />}
            {step === 'pauses' && <PausesStep />}
            {step === 'apiKey' && <ApiKeyStep />}
            {step === 'voices' && <VoicesStep />}
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
              {isLast ? t('onboarding.wizard.done') : t('onboarding.wizard.continue')}
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
