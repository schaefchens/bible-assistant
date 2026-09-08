import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settingsStore';
import { MsSlider } from '@/components/common/MsSlider';
import { StepHeading } from './StepHeading';

export function PausesStep() {
  const { t } = useTranslation();
  const pauseBetweenVersesMs = useSettingsStore((s) => s.pauseBetweenVersesMs);
  const setPauseBetweenVersesMs = useSettingsStore((s) => s.setPauseBetweenVersesMs);
  const pauseBetweenChaptersMs = useSettingsStore((s) => s.pauseBetweenChaptersMs);
  const setPauseBetweenChaptersMs = useSettingsStore((s) => s.setPauseBetweenChaptersMs);

  return (
    <div>
      <StepHeading
        title={t('onboarding.wizard.pauses.title')}
        subtitle={t('onboarding.wizard.pauses.subtitle')}
      />
      <div className="space-y-5">
        <MsSlider
          label={t('onboarding.wizard.pauses.betweenVerses')}
          value={pauseBetweenVersesMs}
          max={3000}
          onChange={setPauseBetweenVersesMs}
        />
        <MsSlider
          label={t('onboarding.wizard.pauses.betweenChapters')}
          value={pauseBetweenChaptersMs}
          max={10000}
          onChange={setPauseBetweenChaptersMs}
        />
      </div>
    </div>
  );
}
