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
      {/* Endonyms, no flag emoji. A flag is a regional-indicator *pair*, and
          when the font cascade doesn't resolve it to an emoji glyph each half
          renders on its own as a boxed capital — which is what showed up on
          iOS instead of 🇺🇸/🇩🇪. It's also the wrong signifier: English isn't
          American and German isn't only Germany's. Settings' own language
          control already used plain labels, so this matches it. */}
      <SegmentedControl
        value={locale}
        options={[
          { value: 'en', label: 'English' },
          { value: 'de', label: 'Deutsch' },
        ]}
        onChange={(v) => setLocale(v as 'en' | 'de')}
      />
    </div>
  );
}
