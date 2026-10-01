import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { usePreviewVoice } from '@/hooks/usePreviewVoice';
import { useVoiceSelection } from '@/hooks/useSpeechVoice';
import {
  OPENAI_VOICES,
  isOpenAiVoiceId,
  type OpenAiVoiceId,
} from '@/services/voices/ttsVoice';
import {
  SYSTEM_DEVICE_ID,
  SYSTEM_ECHO_ID,
  defaultVoiceName,
  findVoice,
  type VoiceRole,
} from '@/services/voices/voiceProfiles';
import { StepHeading } from './StepHeading';

/**
 * The first-run voice choice. Only offered with a personal OpenAI key (see
 * OnboardingWizard), so it lists the plain OpenAI voices; naming a voice,
 * giving it a face, a style or an ElevenLabs voice is Settings › Voices.
 *
 * Picking a base voice makes (or reuses) the voice profile for it and selects
 * it — the same thing "use Nova" does through the assistant.
 */
export function VoicesStep() {
  const { t } = useTranslation();
  const locale = useSettingsStore((s) => s.locale);
  const sampleText = t('onboarding.wizard.voices.previewText');

  return (
    <div className="space-y-6">
      <StepHeading
        title={t('onboarding.wizard.voices.title')}
        subtitle={t('onboarding.wizard.voices.subtitle')}
      />
      <VoiceRow
        role="narration"
        label={t('onboarding.wizard.voices.readerLabel')}
        locale={locale}
        sampleText={sampleText}
      />
      <VoiceRow
        role="assistant"
        label={t('onboarding.wizard.voices.assistantLabel')}
        locale={locale}
        sampleText={sampleText}
      />
      <p className="text-xs text-ink-muted">{t('onboarding.wizard.voices.moreInSettings')}</p>
    </div>
  );
}

/** `'device'`, a plain OpenAI voice, or `'custom'` for a voice made in
 * Settings that this list cannot show as a base voice. */
type RowValue = 'device' | OpenAiVoiceId | 'custom';

function VoiceRow({
  role,
  label,
  locale,
  sampleText,
}: {
  role: VoiceRole;
  label: string;
  locale: 'en' | 'de';
  sampleText: string;
}) {
  const { t } = useTranslation();
  const { previewing, preview, stop } = usePreviewVoice();
  const voices = useLibraryStore((s) => s.voices);
  const selectVoice = useLibraryStore((s) => s.selectVoice);
  const ensureOpenAiVoice = useLibraryStore((s) => s.ensureOpenAiVoice);
  const { id, chosen } = useVoiceSelection(role);

  const custom = findVoice(id, voices);
  const value: RowValue =
    id === SYSTEM_DEVICE_ID
      ? 'device'
      : id === SYSTEM_ECHO_ID
        ? 'echo'
        : custom?.config.provider === 'openai' && custom.config.style === ''
          ? custom.config.voice
          : 'custom';

  const onChange = async (next: string) => {
    stop();
    if (next === 'device') return selectVoice(role, SYSTEM_DEVICE_ID);
    if (!isOpenAiVoiceId(next)) return;
    await selectVoice(role, await ensureOpenAiVoice(next));
  };

  return (
    <div>
      <label className="block text-xs text-ink-muted mb-1">{label}</label>
      <div className="flex gap-2">
        <select
          value={value}
          onChange={(e) => void onChange(e.target.value)}
          className="flex-1 bg-surface-raised text-ink rounded-xl px-3 py-2"
        >
          <option value="device">{t('narrationVoices.system.device')}</option>
          {value === 'custom' && custom && <option value="custom">{custom.name}</option>}
          {OPENAI_VOICES.map((v) => (
            <option key={v} value={v}>
              {defaultVoiceName({ provider: 'openai', voice: v, style: '' })}
              {v === 'marin' || v === 'cedar' ? ' ★' : ''}
            </option>
          ))}
        </select>
        {chosen.provider !== 'device' && (
          <button
            type="button"
            onClick={() =>
              previewing ? stop() : void preview(chosen, locale, sampleText)
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
