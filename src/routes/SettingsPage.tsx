import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore, type MicCorner } from '@/store/settingsStore';
import { VOICE_OPTIONS } from '@/types/domain';
import { getPassphrase } from '@/lib/passphrase';

export function SettingsPage() {
  const { t } = useTranslation();
  const settings = useSettingsStore();
  const passphrase = getPassphrase() ?? '';
  const words = passphrase.split(' ');
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(passphrase);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
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
        <SegmentedControl
          value={settings.translation}
          options={[
            { value: 'ESV', label: 'ESV' },
            { value: 'S00', label: 'Schlachter 2000' },
          ]}
          onChange={(v) => settings.setTranslation(v as 'ESV' | 'S00')}
        />
      </Section>

      <Section title={t('settings.voice')}>
        <select
          value={settings.voice}
          onChange={(e) =>
            settings.setVoice(e.target.value as (typeof VOICE_OPTIONS)[number])
          }
          className="w-full bg-navy-soft text-cream rounded-xl px-3 py-2"
        >
          {VOICE_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </Section>

      <Section title={t('settings.voiceStyle')}>
        <input
          value={settings.voiceStyle}
          onChange={(e) => settings.setVoiceStyle(e.target.value)}
          placeholder={t('settings.voiceStyleHint')}
          className="w-full bg-navy-soft text-cream rounded-xl px-3 py-2"
        />
      </Section>

      <Section title={t('settings.assistantVoice')}>
        <p className="text-xs text-cream-dim mb-2">{t('settings.assistantVoiceHint')}</p>
        <select
          value={settings.assistantVoice}
          onChange={(e) =>
            settings.setAssistantVoice(e.target.value as (typeof VOICE_OPTIONS)[number])
          }
          className="w-full bg-navy-soft text-cream rounded-xl px-3 py-2"
        >
          {VOICE_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
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

      <Section title="Whisper">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.useWhisperFallback}
            onChange={(e) => settings.setUseWhisperFallback(e.target.checked)}
          />
          <span className="text-sm">{t('settings.whisperFallback')}</span>
        </label>
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
    </div>
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

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 bg-navy-soft rounded-xl p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={
            'py-2 text-sm rounded-lg transition-colors ' +
            (value === opt.value ? 'bg-gold text-navy' : 'text-cream-dim hover:text-cream')
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
