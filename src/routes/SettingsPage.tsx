import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore, type MicCorner } from '@/store/settingsStore';
import type { Translation } from '@/services/bible/bibleApi';
import { VOICE_OPTIONS, type VoiceId } from '@/types/domain';
import { getPassphrase } from '@/lib/passphrase';
import { PlaybackSettingsForm } from '@/components/playback/PlaybackSettingsForm';
import { factoryReset } from '@/lib/factoryReset';
import {
  applyUpdate,
  checkForUpdates,
  useUpdateStore,
} from '@/lib/pwaUpdate';

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
        <div className="space-y-2">
          <SegmentedControl
            value={settings.translation}
            cols={3}
            options={[
              { value: 'ESV', label: 'ESV', title: 'English Standard Version' },
              { value: 'KJV', label: 'KJV', title: 'King James Version' },
              { value: 'NKJV', label: 'NKJV', title: 'New King James Version' },
            ]}
            onChange={(v) => settings.setTranslation(v as Translation)}
          />
          <SegmentedControl
            value={settings.translation}
            cols={3}
            options={[
              { value: 'S00', label: 'Schlachter', title: 'Schlachter 2000' },
              { value: 'LUT', label: 'Luther', title: 'Luther 1912' },
              { value: 'HFA', label: 'Hoffnung', title: 'Hoffnung für Alle' },
            ]}
            onChange={(v) => settings.setTranslation(v as Translation)}
          />
          <SegmentedControl
            value={settings.translation}
            cols={2}
            options={[
              { value: 'S51', label: 'SCH 1951', title: 'Schlachter 1951 (mit Strong)' },
              { value: 'ELB', label: 'Elberfelder', title: 'Elberfelder 1905 (mit Strong)' },
            ]}
            onChange={(v) => settings.setTranslation(v as Translation)}
          />
        </div>
      </Section>

      <Section title={t('settings.voice')}>
        <VoiceSelect
          value={settings.voice}
          onChange={(v) => settings.setVoice(v)}
        />
        {settings.voice === 'browser' && (
          <p className="mt-2 text-xs text-cream-dim">{t('settings.browserVoiceHint')}</p>
        )}
      </Section>

      {settings.voice !== 'browser' && (
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
      </Section>

      <PlaybackSettingsForm />

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

      <Imprint />
    </div>
  );
}

function Imprint() {
  const [revealed, setRevealed] = useState(false);
  return (
    <section className="mt-10 pt-6 border-t border-navy-soft/50 text-center text-xs text-cream-dim">
      <h3 className="font-serif text-gold/80 text-sm tracking-wide">
        Impressum
      </h3>
      <p className="text-[10px] uppercase tracking-widest text-cream-dim/70 mt-0.5">
        gemäß § 5 TMG
      </p>

      <div className="mt-4 mx-auto max-w-xs rounded-2xl border border-navy-soft/60 bg-navy-soft/30 px-5 py-4 space-y-2">
        <p className="text-cream-dim/80">Gemacht von:</p>
        {revealed ? (
          <address className="not-italic leading-relaxed text-cream">
            Christoph Scharf
            <br />
            Mühltorstr. 1
            <br />
            67245 Lambsheim
            <br />
            <a
              href="mailto:christoph.scharf+bibleassistant@scharfmedia.de"
              className="text-gold hover:text-gold/80 break-all"
            >
              christoph.scharf+bibleassistant@scharfmedia.de
            </a>
          </address>
        ) : (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="text-cream underline decoration-dotted underline-offset-4 hover:text-gold transition-colors"
          >
            einem Diener des Herrn
          </button>
        )}
        <p className="pt-2 italic text-cream-dim/80 font-serif">
          „Mit der Gnade Gottes und Claude"
        </p>
      </div>
    </section>
  );
}

function UpdatesSection() {
  const { t, i18n } = useTranslation();
  const needRefresh = useUpdateStore((s) => s.needRefresh);
  const [status, setStatus] = useState<'idle' | 'checking' | 'upToDate' | 'found'>(
    'idle',
  );

  const buildDate = (() => {
    try {
      return new Date(__BUILD_TIME__).toLocaleString(i18n.language || undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return __BUILD_TIME__;
    }
  })();

  const onCheck = async () => {
    setStatus('checking');
    await checkForUpdates();
    // Give the SW a brief moment to dispatch `onNeedRefresh` if a new version
    // was found.
    await new Promise((r) => setTimeout(r, 1200));
    if (useUpdateStore.getState().needRefresh) {
      setStatus('found');
      await new Promise((r) => setTimeout(r, 600));
      void applyUpdate();
    } else {
      setStatus('upToDate');
      window.setTimeout(() => setStatus('idle'), 2500);
    }
  };

  const label =
    status === 'checking'
      ? t('settings.updates.checking')
      : status === 'upToDate'
        ? t('settings.updates.upToDate')
        : status === 'found' || needRefresh
          ? t('settings.updates.found')
          : t('settings.updates.check');

  return (
    <div className="space-y-3">
      <p className="text-xs text-cream-dim font-mono">
        {t('settings.updates.version', {
          commit: __GIT_COMMIT__,
          date: buildDate,
        })}
      </p>
      <button
        type="button"
        className="btn-ghost text-xs"
        onClick={() => void onCheck()}
        disabled={status === 'checking' || status === 'found'}
      >
        {label}
      </button>
    </div>
  );
}

function DangerZone() {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [wiping, setWiping] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const id = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirming]);

  const onClick = () => {
    if (wiping) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setWiping(true);
    void factoryReset();
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-cream-dim">{t('settings.dangerZone.hint')}</p>
      <button
        type="button"
        onClick={onClick}
        disabled={wiping}
        className="text-sm text-red-400 hover:bg-red-500/10 border border-red-500/40 rounded-xl px-3 py-2 transition-colors disabled:opacity-60"
      >
        {wiping
          ? t('settings.dangerZone.wiping')
          : confirming
            ? t('settings.dangerZone.confirm')
            : t('settings.dangerZone.wipe')}
      </button>
    </div>
  );
}

function VoiceSelect({
  value,
  onChange,
}: {
  value: VoiceId;
  onChange: (v: VoiceId) => void;
}) {
  const { t } = useTranslation();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as VoiceId)}
      className="w-full bg-navy-soft text-cream rounded-xl px-3 py-2"
    >
      {VOICE_OPTIONS.map((v) => (
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

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  cols = 2,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  cols?: 2 | 3;
}) {
  const colsCls = cols === 3 ? 'grid-cols-3' : 'grid-cols-2';
  return (
    <div className={`grid ${colsCls} bg-navy-soft rounded-xl p-1`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          title={opt.title}
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
