import { useTranslation } from 'react-i18next';

/**
 * First screen. No account, no passphrase, no network — just the door in.
 *
 * The recovery link is the one thing that has to be here rather than in
 * Settings: someone reinstalling on a new device needs it before they start
 * making local data that a restore would then have to merge.
 */
export function WelcomeStep({ onRestore }: { onRestore: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full text-center">
      <h1 className="text-3xl font-serif text-gold mb-3">{t('app.title')}</h1>
      <p className="text-cream-dim mb-2">{t('onboarding.wizard.welcome.subtitle')}</p>
      <p className="text-xs text-cream-dim/70">{t('onboarding.wizard.welcome.offline')}</p>
      <button
        type="button"
        onClick={onRestore}
        className="text-xs text-gold hover:text-gold/80 mt-8 underline underline-offset-4"
      >
        {t('onboarding.wizard.welcome.restore')}
      </button>
    </div>
  );
}
