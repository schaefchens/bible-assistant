import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settingsStore';
import { usePreviewVoice } from '@/hooks/usePreviewVoice';
import {
  OPENAI_VOICE_OPTIONS,
  type OpenAiVoiceId,
  type VoiceId,
} from '@/types/domain';
import { StepHeading } from './StepHeading';

export function VoicesStep() {
  const { t } = useTranslation();
  const voice = useSettingsStore((s) => s.voice);
  const setVoice = useSettingsStore((s) => s.setVoice);
  const assistantVoice = useSettingsStore((s) => s.assistantVoice);
  const setAssistantVoice = useSettingsStore((s) => s.setAssistantVoice);
  const locale = useSettingsStore((s) => s.locale);
  const sampleText = t('onboarding.wizard.voices.previewText');

  return (
    <div className="space-y-6">
      <StepHeading
        title={t('onboarding.wizard.voices.title')}
        subtitle={t('onboarding.wizard.voices.subtitle')}
      />
      <VoiceRow
        label={t('onboarding.wizard.voices.readerLabel')}
        value={voice}
        onChange={(v) => setVoice(v)}
        locale={locale}
        sampleText={sampleText}
      />
      <VoiceRow
        label={t('onboarding.wizard.voices.assistantLabel')}
        value={assistantVoice}
        onChange={(v) => setAssistantVoice(v)}
        locale={locale}
        sampleText={sampleText}
      />
    </div>
  );
}

function VoiceRow({
  label,
  value,
  onChange,
  locale,
  sampleText,
}: {
  label: string;
  value: VoiceId;
  onChange: (v: VoiceId) => void;
  locale: 'en' | 'de';
  sampleText: string;
}) {
  const { t } = useTranslation();
  const { previewing, preview, stop } = usePreviewVoice();

  return (
    <div>
      <label className="block text-xs text-cream-dim mb-1">{label}</label>
      <div className="flex gap-2">
        <select
          value={value}
          onChange={(e) => {
            stop();
            onChange(e.target.value as VoiceId);
          }}
          className="flex-1 bg-navy-soft text-cream rounded-xl px-3 py-2"
        >
          <option value="browser">{t('settings.browserVoice')}</option>
          {OPENAI_VOICE_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        {value !== 'browser' && (
          <button
            type="button"
            onClick={() =>
              previewing
                ? stop()
                : void preview(value as OpenAiVoiceId, locale, sampleText)
            }
            className="btn-ghost h-auto px-3 text-xs whitespace-nowrap"
          >
            {previewing
              ? t('onboarding.wizard.voices.stop')
              : t('onboarding.wizard.voices.preview')}
          </button>
        )}
      </div>
    </div>
  );
}
