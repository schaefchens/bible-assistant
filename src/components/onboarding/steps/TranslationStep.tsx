import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settingsStore';
import { TranslationList } from '@/components/bible/TranslationList';
import { StepHeading } from './StepHeading';

export function TranslationStep() {
  const { t } = useTranslation();
  const translation = useSettingsStore((s) => s.translation);
  const setTranslation = useSettingsStore((s) => s.setTranslation);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <StepHeading
        title={t('onboarding.wizard.translation.title')}
        subtitle={t('onboarding.wizard.translation.subtitle')}
      />
      <div className="flex-1 min-h-0 rounded-xl border border-surface-raised/40 overflow-y-auto py-1">
        <TranslationList
          value={translation}
          onChange={(code) => setTranslation(code, true)}
        />
      </div>
    </div>
  );
}
