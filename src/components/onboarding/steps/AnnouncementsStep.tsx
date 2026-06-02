import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settingsStore';
import { StepHeading } from './StepHeading';

export function AnnouncementsStep() {
  const { t } = useTranslation();
  const readChapterHeadings = useSettingsStore((s) => s.readChapterHeadings);
  const setReadChapterHeadings = useSettingsStore((s) => s.setReadChapterHeadings);
  const readVerseNumbers = useSettingsStore((s) => s.readVerseNumbers);
  const setReadVerseNumbers = useSettingsStore((s) => s.setReadVerseNumbers);
  return (
    <div>
      <StepHeading
        title={t('onboarding.wizard.announcements.title')}
        subtitle={t('onboarding.wizard.announcements.subtitle')}
      />
      <div className="space-y-3">
        <label className="flex items-center gap-3 bg-navy-soft rounded-xl px-4 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={readChapterHeadings}
            onChange={(e) => setReadChapterHeadings(e.target.checked)}
          />
          <span className="text-sm">{t('onboarding.wizard.announcements.heading')}</span>
        </label>
        <label className="flex items-center gap-3 bg-navy-soft rounded-xl px-4 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={readVerseNumbers}
            onChange={(e) => setReadVerseNumbers(e.target.checked)}
          />
          <span className="text-sm">{t('onboarding.wizard.announcements.verseNumbers')}</span>
        </label>
      </div>
    </div>
  );
}
