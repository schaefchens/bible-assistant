import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settingsStore';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { StepHeading } from './StepHeading';

export function LanguageStep() {
  const { t } = useTranslation();
  const locale = useSettingsStore((s) => s.locale);
  const setLocale = useSettingsStore((s) => s.setLocale);
  return (
    <div>
      <StepHeading
        title={t('onboarding.wizard.language.title')}
        subtitle={t('onboarding.wizard.language.subtitle')}
      />
      <SegmentedControl
        value={locale}
        options={[
          { value: 'en', label: '🇺🇸  English' },
          { value: 'de', label: '🇩🇪  Deutsch' },
        ]}
        onChange={(v) => setLocale(v as 'en' | 'de')}
      />
    </div>
  );
}
