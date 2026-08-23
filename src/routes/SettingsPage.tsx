import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  hasActivePersonalKey,
  useSettingsStore,
  type MicCorner,
} from '@/store/settingsStore';
import { VOICE_OPTIONS, type VoiceId } from '@/types/domain';
import { getPassphrase } from '@/lib/passphrase';
import { PlaybackSettingsForm } from '@/components/playback/PlaybackSettingsForm';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { TranslationPickerSheet } from '@/components/bible/TranslationPickerSheet';
import { OpenAiKeySection } from '@/components/settings/OpenAiKeySection';
import { UpdatesSection } from '@/components/settings/UpdatesSection';
import { SyncSection } from '@/components/settings/SyncSection';
import { DangerZone } from '@/components/settings/DangerZone';
import { ImprintFooter } from '@/components/settings/ImprintFooter';
import { getTranslationInfo } from '@/services/bible/translationCatalog';
import { copyText } from '@/lib/nativeBridge';
import clsx from 'clsx';

export function SettingsPage() {
  const { t } = useTranslation();
  const settings = useSettingsStore();
  const passphrase = getPassphrase() ?? '';
  const words = passphrase.split(' ');
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [translationPickerOpen, setTranslationPickerOpen] = useState(false);
  const currentTranslation = getTranslationInfo(settings.translation);

  const onCopy = async () => {
    if (!(await copyText(passphrase))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      <h2 className="text-xl font-serif text-gold">{t('settings.title')}</h2>

      <Section title={t('settings.language')}>
        <SegmentedControl
          value={settings.locale}
          options={[
            { value: 'en', label: 'English' },
            { value: 'de', label: 'Deutsch' },
          ]}
          onChange={(v) => settings.setLocale(v as 'en' | 'de')}
        />
      </Section>

      <Section title={t('settings.translation')}>
        <button
          type="button"
          onClick={() => setTranslationPickerOpen(true)}
          aria-label={t('chat.bookPicker.changeTranslation') as string}
          className={clsx(
            'w-full flex items-center gap-3 rounded-xl px-3 py-2.5',
            'bg-navy/60 border border-gold/30 hover:border-gold/60 hover:bg-navy/80',
            'transition-colors text-left',
          )}
        >
          <span
            className={clsx(
              'shrink-0 inline-flex items-center justify-center',
              'min-w-[3rem] px-2 py-0.5 rounded-md text-xs font-mono tracking-wide',
              'border border-gold/60 text-gold bg-gold/10',
            )}
          >
            {currentTranslation.code}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-serif text-gold text-sm leading-tight truncate">
              {currentTranslation.name}
            </span>
            <span className="block text-xs text-cream-dim/80 mt-0.5">
              {currentTranslation.year} ·{' '}
              {currentTranslation.language === 'de'
                ? t('chat.bookPicker.languageDe')
                : t('chat.bookPicker.languageEn')}
            </span>
          </span>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-cream-dim shrink-0"
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </Section>

      <TranslationPickerSheet
        open={translationPickerOpen}
        value={settings.translation}
        onChange={(code) => settings.setTranslation(code, true)}
        onClose={() => setTranslationPickerOpen(false)}
      />

      <Section title={t('settings.voice')}>
        <VoiceSelect
          value={settings.voice}
          onChange={(v) => settings.setVoice(v)}
          allowedVoices={hasActivePersonalKey(settings) ? undefined : ['echo', 'browser']}
        />
        {settings.voice === 'browser' && (
          <p className="mt-2 text-xs text-cream-dim">{t('settings.browserVoiceHint')}</p>
        )}
        {!hasActivePersonalKey(settings) && (
          <p className="mt-2 text-xs text-cream-dim">
            {t('settings.readingVoiceRestricted')}
          </p>
        )}
      </Section>

      {settings.voice !== 'browser' && hasActivePersonalKey(settings) && (
        <Section title={t('settings.voiceStyle')}>
          <input
            value={settings.voiceStyle}
            onChange={(e) => settings.setVoiceStyle(e.target.value)}
            placeholder={t('settings.voiceStyleHint')}
            className="w-full bg-navy-soft text-cream rounded-xl px-3 py-2"
          />
        </Section>
      )}

      <Section title={t('settings.assistantVoice')}>
        <p className="text-xs text-cream-dim mb-2">{t('settings.assistantVoiceHint')}</p>
        <VoiceSelect
          value={settings.assistantVoice}
          onChange={(v) => settings.setAssistantVoice(v)}
          allowedVoices={hasActivePersonalKey(settings) ? undefined : ['browser']}
        />
        <label className="flex items-center gap-2 mt-3">
          <input
            type="checkbox"
            checked={settings.speakAssistant}
            onChange={(e) => settings.setSpeakAssistant(e.target.checked)}
          />
          <span className="text-sm">{t('settings.speakAssistant')}</span>
        </label>
      </Section>

      <Section title={t('voice.mic.position')}>
        <p className="text-xs text-cream-dim mb-2">{t('voice.mic.dragHint')}</p>
        <MicCornerPicker
          value={settings.micCorner}
          onChange={(v) => settings.setMicCorner(v)}
        />
      </Section>

      <Section title={t('settings.microphone')}>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.useWhisperFallback}
            onChange={(e) => settings.setUseWhisperFallback(e.target.checked)}
          />
          <span className="text-sm">{t('settings.whisperFallback')}</span>
        </label>
        <label className="flex items-center gap-2 mt-2">
          <input
            type="checkbox"
            checked={settings.micSoundEnabled}
            onChange={(e) => settings.setMicSoundEnabled(e.target.checked)}
          />
          <span className="text-sm">{t('settings.micSound')}</span>
        </label>
        <label className="flex items-center gap-2 mt-2">
          <input
            type="checkbox"
            checked={settings.thinkingSoundEnabled}
            onChange={(e) => settings.setThinkingSoundEnabled(e.target.checked)}
          />
          <span className="text-sm">{t('settings.thinkingSound')}</span>
        </label>
      </Section>

      <PlaybackSettingsForm />

      <Section title={t('settings.openaiKey.title')}>
        <OpenAiKeySection />
      </Section>

      <Section title={t('settings.sync.title')}>
        <SyncSection />
      </Section>

      <Section title={t('settings.identity')}>
        <p className="text-xs text-cream-dim mb-2">{t('settings.identityHint')}</p>
        {!revealed ? (
          <button className="btn-ghost text-xs" onClick={() => setRevealed(true)}>
            {t('settings.reveal')}
          </button>
        ) : (
          <>
            <ol className="grid grid-cols-2 gap-x-3 gap-y-2 bg-navy-soft rounded-xl p-4">
              {words.map((w, i) => (
                <li key={i} className="flex items-baseline gap-2 text-sm font-mono">
                  <span className="text-gold-dim text-xs w-6 text-right tabular-nums">{i + 1}.</span>
                  <span className="text-cream">{w}</span>
                </li>
              ))}
            </ol>
            <div className="flex gap-2 mt-3">
              <button className="btn-ghost text-xs" onClick={onCopy}>
                {copied ? '✓ ' + t('settings.copy') : t('settings.copy')}
              </button>
              <button className="btn-ghost text-xs" onClick={() => setRevealed(false)}>
                {t('settings.hide')}
              </button>
            </div>
          </>
        )}
      </Section>

      <Section title={t('settings.updates.title')}>
        <UpdatesSection />
      </Section>

      <Section title={t('settings.dangerZone.title')}>
        <DangerZone />
      </Section>

      <ImprintFooter />
    </div>
  );
}

function VoiceSelect({
  value,
  onChange,
  allowedVoices,
}: {
  value: VoiceId;
  onChange: (v: VoiceId) => void;
  /** Optional allowlist; defaults to the full VOICE_OPTIONS list. */
  allowedVoices?: VoiceId[];
}) {
  const { t } = useTranslation();
  const options = allowedVoices
    ? VOICE_OPTIONS.filter((v) => allowedVoices.includes(v))
    : VOICE_OPTIONS;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as VoiceId)}
      className="w-full bg-navy-soft text-cream rounded-xl px-3 py-2"
    >
      {options.map((v) => (
        <option key={v} value={v}>
          {v === 'browser' ? t('settings.browserVoice') : v}
        </option>
      ))}
    </select>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs uppercase tracking-wide text-gold-dim mb-2">{title}</h3>
      {children}
    </section>
  );
}

function MicCornerPicker({
  value,
  onChange,
}: {
  value: MicCorner;
  onChange: (v: MicCorner) => void;
}) {
  const { t } = useTranslation();
  const corners: { value: MicCorner; label: string }[] = [
    { value: 'tl', label: t('voice.mic.tl') },
    { value: 'tr', label: t('voice.mic.tr') },
    { value: 'bl', label: t('voice.mic.bl') },
    { value: 'br', label: t('voice.mic.br') },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {corners.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onChange(c.value)}
          className={
            'py-3 text-sm rounded-xl border transition-colors ' +
            (value === c.value
              ? 'bg-gold/15 text-gold border-gold/60'
              : 'bg-navy-soft text-cream-dim border-navy-soft hover:text-cream')
          }
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

