import { useEffect, useRef, useState } from 'react';
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
import { getTranslationInfo } from '@/services/bible/translationCatalog';
import clsx from 'clsx';
import { factoryReset } from '@/lib/factoryReset';
import {
  applyUpdate,
  checkForUpdates,
  useUpdateStore,
} from '@/lib/pwaUpdate';
import { ApiError } from '@/services/api/client';
import { clearOpenAiKey, setOpenAiKey } from '@/services/api/auth';

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
  const [sheep, setSheep] = useState(false);
  const sheepTimer = useRef<number | null>(null);
  const revealTimer = useRef<number | null>(null);

  const clearTimers = () => {
    if (sheepTimer.current !== null) {
      window.clearTimeout(sheepTimer.current);
      sheepTimer.current = null;
    }
    if (revealTimer.current !== null) {
      window.clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
  };

  // Sheep at 1s as visual confirmation that the long-press is registering;
  // reveal at 3s. Releasing early aborts both. § 5 TMG still calls for
  // imprint disclosure, but a Diener des Herrn doesn't make it easy ;)
  const onPressStart = () => {
    if (revealed) return;
    clearTimers();
    sheepTimer.current = window.setTimeout(() => setSheep(true), 1000);
    revealTimer.current = window.setTimeout(() => {
      setRevealed(true);
      setSheep(false);
    }, 3000);
  };

  const onPressEnd = () => {
    clearTimers();
    setSheep(false);
  };

  useEffect(() => () => clearTimers(), []);

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
          <>
            <button
              type="button"
              onPointerDown={onPressStart}
              onPointerUp={onPressEnd}
              onPointerLeave={onPressEnd}
              onPointerCancel={onPressEnd}
              onContextMenu={(e) => e.preventDefault()}
              className="text-cream underline decoration-dotted underline-offset-4 hover:text-gold transition-colors select-none"
              style={{ WebkitTouchCallout: 'none' }}
            >
              einem Diener des Herrn
            </button>
            {sheep && (
              <div
                aria-hidden="true"
                className="text-6xl leading-none mt-2 select-none pointer-events-none"
              >
                🐑
              </div>
            )}
          </>
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

function OpenAiKeySection() {
  const { t } = useTranslation();
  const hasKey = useSettingsStore((s) => s.hasUserOpenAiKey);
  const masked = useSettingsStore((s) => s.userOpenAiKeyMasked);
  const sessionPreferShared = useSettingsStore((s) => s.sessionPreferSharedKey);
  const setStatus = useSettingsStore((s) => s.setUserOpenAiKeyStatus);
  const setPreferShared = useSettingsStore((s) => s.setSessionPreferSharedKey);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSave = async () => {
    const key = draft.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await setOpenAiKey(key);
      setStatus(!!resp.hasKey, resp.masked ?? null);
      setDraft('');
      // A freshly-validated key cancels any prior shared-key opt-in.
      if (sessionPreferShared) setPreferShared(false);
    } catch (e) {
      setError(extractErrorDetail(e) ?? t('settings.openaiKey.invalid'));
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    setBusy(true);
    setError(null);
    try {
      await clearOpenAiKey();
      setStatus(false, null);
    } catch (e) {
      setError(extractErrorDetail(e) ?? 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-cream-dim">{t('settings.openaiKey.hint')}</p>
      {hasKey ? (
        <>
          <div className="flex items-center justify-between gap-2 bg-navy-soft rounded-xl px-3 py-2">
            <span className="font-mono text-sm text-cream">{masked ?? '••••••'}</span>
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={busy}
              onClick={() => void onClear()}
            >
              {t('settings.openaiKey.remove')}
            </button>
          </div>
          {sessionPreferShared && (
            <p className="text-xs text-red-400">
              {t('settings.openaiKey.usingSharedThisSession')}{' '}
              <button
                type="button"
                className="underline"
                onClick={() => setPreferShared(false)}
              >
                {t('settings.openaiKey.retryWithMine')}
              </button>
            </p>
          )}
        </>
      ) : (
        <div className="flex gap-2">
          <input
            type="password"
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="sk-..."
            className="flex-1 bg-navy-soft text-cream rounded-xl px-3 py-2 font-mono text-sm"
          />
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => void onSave()}
            className="btn-ghost text-xs disabled:opacity-50"
          >
            {busy ? t('settings.openaiKey.saving') : t('settings.openaiKey.save')}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

function extractErrorDetail(e: unknown): string | null {
  if (e instanceof ApiError && e.body && typeof e.body === 'object') {
    const body = e.body as { detail?: unknown; error?: unknown };
    if (typeof body.detail === 'string' && body.detail) return body.detail;
    if (typeof body.error === 'string' && body.error) return body.error;
  }
  return e instanceof Error ? e.message : null;
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

