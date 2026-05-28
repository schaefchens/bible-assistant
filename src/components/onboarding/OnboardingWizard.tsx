import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useSettingsStore } from '@/store/settingsStore';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { TranslationList } from '@/components/bible/TranslationList';
import { getAmbientTracks, type AmbientTrack } from '@/services/api/ambient';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { setOpenAiKey } from '@/services/api/auth';
import { postTtsSpeak } from '@/services/api/tts';
import { ApiError } from '@/services/api/client';
import {
  OPENAI_VOICE_OPTIONS,
  type OpenAiVoiceId,
  type VoiceId,
} from '@/types/domain';

type Step =
  | 'language'
  | 'translation'
  | 'music'
  | 'announcements'
  | 'pauses'
  | 'apiKey'
  | 'voices';

const BASE_STEPS: Step[] = [
  'language',
  'translation',
  'music',
  'announcements',
  'pauses',
  'apiKey',
];

export function OnboardingWizard({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('language');
  const hasUserOpenAiKey = useSettingsStore((s) => s.hasUserOpenAiKey);

  // Voices step only exists once the user has saved a valid personal key,
  // so existing wizard navigation just grows by one screen if/when they do.
  const steps = useMemo<Step[]>(
    () => (hasUserOpenAiKey ? [...BASE_STEPS, 'voices'] : BASE_STEPS),
    [hasUserOpenAiKey],
  );
  const idx = Math.max(0, steps.indexOf(step));
  const isLast = idx === steps.length - 1;

  // Seed wizard-preferred defaults on first paint — but only when the user
  // hasn't already nudged them away from the factory values, so a returning
  // visitor (e.g. via "Wipe all data" then re-onboarding) doesn't get their
  // earlier choices stomped before they reach the relevant step.
  useEffect(() => {
    const s = useSettingsStore.getState();
    if (!s.readChapterHeadings) s.setReadChapterHeadings(true);
    if (s.pauseBetweenVersesMs === 0) s.setPauseBetweenVersesMs(200);
    if (s.pauseBetweenChaptersMs === 0) s.setPauseBetweenChaptersMs(5000);
  }, []);

  const next = () => {
    if (isLast) onDone();
    else setStep(steps[idx + 1]);
  };
  const back = () => {
    if (idx > 0) setStep(steps[idx - 1]);
  };

  return (
    <div className="flex flex-col h-full pt-safe pb-safe bg-navy text-cream">
      <div className="flex-1 min-h-0 px-6 py-6 flex flex-col">
        <div className="max-w-md mx-auto w-full flex flex-col flex-1 min-h-0">
          <header className="flex items-center justify-between gap-4 mb-8">
            <Progress idx={idx} total={steps.length} />
            <button
              type="button"
              onClick={onDone}
              className="text-xs text-cream-dim hover:text-cream whitespace-nowrap"
            >
              {t('onboarding.wizard.skip')} →
            </button>
          </header>

          <div className="flex-1 min-h-0 flex flex-col justify-center">
            {step === 'language' && <LanguageStep />}
            {step === 'translation' && <TranslationStep />}
            {step === 'music' && <MusicStep />}
            {step === 'announcements' && <AnnouncementsStep />}
            {step === 'pauses' && <PausesStep />}
            {step === 'apiKey' && <ApiKeyStep />}
            {step === 'voices' && <VoicesStep />}
          </div>

          <footer className="flex items-center justify-between gap-3 mt-10">
            {idx > 0 ? (
              <button
                type="button"
                onClick={back}
                className="btn-ghost px-4 py-3"
              >
                ← {t('onboarding.wizard.back')}
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={next}
              className="btn-primary px-6 py-3 flex-1 max-w-[12rem]"
            >
              {isLast ? t('onboarding.wizard.done') : t('onboarding.wizard.continue')}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}

function Progress({ idx, total }: { idx: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={clsx(
            'h-1.5 rounded-full transition-all',
            i === idx ? 'w-8 bg-gold' : i < idx ? 'w-6 bg-gold/60' : 'w-6 bg-navy-soft',
          )}
        />
      ))}
    </div>
  );
}

function StepHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-8 text-center">
      <h2 className="text-2xl font-serif text-gold mb-2">{title}</h2>
      <p className="text-sm text-cream-dim">{subtitle}</p>
    </div>
  );
}

function LanguageStep() {
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

function TranslationStep() {
  const { t } = useTranslation();
  const translation = useSettingsStore((s) => s.translation);
  const setTranslation = useSettingsStore((s) => s.setTranslation);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <StepHeading
        title={t('onboarding.wizard.translation.title')}
        subtitle={t('onboarding.wizard.translation.subtitle')}
      />
      <div className="flex-1 min-h-0 rounded-xl border border-navy-soft/40 overflow-y-auto py-1">
        <TranslationList
          value={translation}
          onChange={(code) => setTranslation(code, true)}
        />
      </div>
    </div>
  );
}

function MusicStep() {
  const { t } = useTranslation();
  const ambient = useSettingsStore((s) => s.ambient);
  const setAmbient = useSettingsStore((s) => s.setAmbient);

  const [tracks, setTracks] = useState<AmbientTrack[] | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    let alive = true;
    getAmbientTracks()
      .then((list) => {
        if (alive) setTracks(list);
      })
      .catch(() => {
        if (alive) setTracks([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Stop any preview when leaving the music step (or unmounting the wizard).
  useEffect(() => {
    return () => {
      audioPlayback.ambient.pause();
    };
  }, []);

  const selectedTrack = tracks?.find((tr) => tr.id === ambient.trackId) ?? null;

  const playTrack = async (url: string) => {
    audioPlayback.ensureContext();
    try {
      await audioPlayback.ambient.load(url);
      audioPlayback.ambient.play();
      setPreviewing(true);
    } catch (e) {
      console.warn('ambient preview failed', e);
    }
  };
  const onPreview = () => {
    if (!selectedTrack) return;
    void playTrack(selectedTrack.url);
  };
  const onStopPreview = () => {
    audioPlayback.ambient.pause();
    setPreviewing(false);
  };
  const onSelectTrack = (newId: string | null) => {
    setAmbient({ trackId: newId });
    // If we were already auditioning, swap to the new pick instead of cutting
    // out — selecting from the dropdown while previewing implies "play this
    // one now."
    if (!previewing) return;
    if (!newId) {
      onStopPreview();
      return;
    }
    const tr = tracks?.find((t) => t.id === newId);
    if (tr) void playTrack(tr.url);
    else onStopPreview();
  };

  return (
    <div>
      <StepHeading
        title={t('onboarding.wizard.music.title')}
        subtitle={t('onboarding.wizard.music.subtitle')}
      />
      <label className="flex items-center gap-3 bg-navy-soft rounded-xl px-4 py-3 cursor-pointer">
        <input
          type="checkbox"
          checked={ambient.enabled}
          onChange={(e) => {
            if (!e.target.checked) onStopPreview();
            setAmbient({ enabled: e.target.checked });
          }}
        />
        <span className="text-sm">{t('onboarding.wizard.music.enable')}</span>
      </label>

      {ambient.enabled && (
        <div className="mt-4">
          <label className="block text-xs text-cream-dim mb-1">
            {t('onboarding.wizard.music.pickTrack')}
          </label>
          <div className="flex gap-2">
            <select
              value={ambient.trackId ?? ''}
              onChange={(e) => onSelectTrack(e.target.value || null)}
              disabled={tracks === null}
              className="flex-1 bg-navy-soft text-cream rounded-xl px-3 py-2 disabled:opacity-50"
            >
              <option value="">
                {tracks === null
                  ? t('onboarding.wizard.music.loadingTracks')
                  : tracks.length === 0
                    ? t('onboarding.wizard.music.noTracks')
                    : t('onboarding.wizard.music.pickTrackPlaceholder')}
              </option>
              {tracks?.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.title}
                </option>
              ))}
            </select>
            {selectedTrack && (
              <button
                type="button"
                onClick={previewing ? onStopPreview : onPreview}
                className="btn-ghost h-auto px-3 text-xs whitespace-nowrap"
              >
                {previewing
                  ? t('onboarding.wizard.music.stop')
                  : t('onboarding.wizard.music.preview')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AnnouncementsStep() {
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

function PausesStep() {
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

function ApiKeyStep() {
  const { t } = useTranslation();
  const hasKey = useSettingsStore((s) => s.hasUserOpenAiKey);
  const masked = useSettingsStore((s) => s.userOpenAiKeyMasked);
  const setStatus = useSettingsStore((s) => s.setUserOpenAiKeyStatus);
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
    } catch (e) {
      setError(extractErrorDetail(e) ?? t('onboarding.wizard.apiKey.invalid'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <StepHeading
        title={t('onboarding.wizard.apiKey.title')}
        subtitle={t('onboarding.wizard.apiKey.subtitle')}
      />
      {hasKey ? (
        <div className="flex items-center justify-between gap-2 bg-navy-soft rounded-xl px-4 py-3">
          <span className="font-mono text-sm text-cream">{masked ?? '••••••'}</span>
          <span className="text-xs text-gold">✓ {t('onboarding.wizard.apiKey.saved')}</span>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            type="password"
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('onboarding.wizard.apiKey.placeholder')}
            className="flex-1 bg-navy-soft text-cream rounded-xl px-3 py-2 font-mono text-sm"
          />
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => void onSave()}
            className="btn-ghost text-xs disabled:opacity-50 whitespace-nowrap"
          >
            {busy
              ? t('onboarding.wizard.apiKey.saving')
              : t('onboarding.wizard.apiKey.save')}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
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

function VoicesStep() {
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

function usePreviewVoice() {
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const stop = () => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        /* may already be stopped */
      }
      sourceRef.current = null;
    }
    setPreviewing(false);
  };

  // Always stop the preview when this row unmounts (wizard exit, step change).
  useEffect(() => stop, []);

  const preview = async (
    voice: OpenAiVoiceId,
    locale: 'en' | 'de',
    text: string,
  ) => {
    stop();
    try {
      const tts = await postTtsSpeak({ text, voice, language: locale });
      const resp = await fetch(tts.audioUrl);
      const arr = await resp.arrayBuffer();
      const ctx = audioPlayback.ensureContext();
      const buf = await ctx.decodeAudioData(arr);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
      sourceRef.current = src;
      setPreviewing(true);
      src.onended = () => {
        if (sourceRef.current === src) {
          sourceRef.current = null;
          setPreviewing(false);
        }
      };
    } catch (e) {
      console.warn('voice preview failed', e);
      setPreviewing(false);
    }
  };

  return { previewing, preview, stop };
}

function MsSlider({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="flex items-center justify-between text-xs text-cream-dim mb-1">
        <span>{label}</span>
        <span className="font-mono tabular-nums">{(value / 1000).toFixed(1)}s</span>
      </label>
      <input
        type="range"
        min={0}
        max={max}
        step={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-gold"
      />
    </div>
  );
}
