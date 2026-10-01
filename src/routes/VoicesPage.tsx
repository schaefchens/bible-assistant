import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronIcon, PlusIcon, SpeakerIcon, SpinnerIcon, StopIcon } from '@/components/common/icons';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { OpenAiKeySection } from '@/components/settings/OpenAiKeySection';
import { ElevenLabsKeySection } from '@/components/voiceProfiles/ElevenLabsKeySection';
import { VoiceAvatar } from '@/components/voiceProfiles/VoiceAvatar';
import { VoiceEditor } from '@/components/voiceProfiles/VoiceEditor';
import { VoiceTile } from '@/components/voiceProfiles/VoiceTile';
import { unavailableReason, voiceSubtitle } from '@/components/voiceProfiles/voiceLabels';
import { useGoBack } from '@/hooks/useGoBack';
import { useLocale } from '@/hooks/useLocale';
import { usePreviewVoice } from '@/hooks/usePreviewVoice';
import { useVoiceSelection } from '@/hooks/useSpeechVoice';
import { ROUTES } from '@/lib/appRoutes';
import { DEVICE_VOICE, ECHO_VOICE, type SpeechVoice } from '@/services/voices/ttsVoice';
import {
  SYSTEM_DEVICE_ID,
  SYSTEM_ECHO_ID,
  findVoice,
  voiceAvailability,
  type VoiceAccess,
  type VoiceRole,
} from '@/services/voices/voiceProfiles';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Narration voices: `/settings/voices` is the gallery, `/settings/voices/:id`
 * (or `new`) the editor — one component branching on the param, as
 * `/lists` + `/lists/:id` do.
 *
 * State the page needs lives in the query string, never a `#fragment`: on
 * native the router is a HashRouter, so the hash *is* the route. `?for=assistant`
 * picks the role being chosen for; `?focus=providers` scrolls to the keys.
 */
export function VoicesPage() {
  const { id } = useParams<{ id?: string }>();
  const [params] = useSearchParams();
  const role: VoiceRole = params.get('for') === 'assistant' ? 'assistant' : 'narration';
  if (id) return <VoiceEditorRoute id={id} role={role} />;
  return <VoiceGallery role={role} />;
}

function VoiceEditorRoute({ id, role }: { id: string; role: VoiceRole }) {
  const { t } = useTranslation();
  const voices = useLibraryStore((s) => s.voices);
  const initialized = useLibraryStore((s) => s.initialized);
  const back = useGoBack(role === 'assistant' ? `${ROUTES.voices}?for=assistant` : ROUTES.voices);
  const profile = id === 'new' ? undefined : findVoice(id, voices);
  if (id !== 'new' && !profile) {
    // Deleted on another device, or a stale link. Before the library has
    // loaded, "missing" would be a lie, so say nothing yet.
    if (!initialized) return null;
    return (
      <div className="p-6 text-center space-y-3">
        <p className="text-sm text-ink-muted">{t('narrationVoices.editor.missing')}</p>
        <button type="button" className="btn-ghost" onClick={back}>
          {t('common.back')}
        </button>
      </div>
    );
  }
  return <VoiceEditor key={id} profile={profile} role={role} onDone={back} />;
}

function VoiceGallery({ role }: { role: VoiceRole }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useLocale();
  const [params, setParams] = useSearchParams();
  const voices = useLibraryStore((s) => s.voices);
  const selection = useLibraryStore((s) => s.voiceSelection);
  const selectVoice = useLibraryStore((s) => s.selectVoice);
  const syncEnabled = useSettingsStore((s) => s.syncEnabled);
  const openAiKey = useSettingsStore((s) => s.hasUserOpenAiKey && !s.sessionPreferSharedKey);
  const elevenLabsKey = useSettingsStore((s) => s.hasUserElevenLabsKey);
  const elevenLabsFailure = useSettingsStore((s) => s.elevenLabsFailure);
  const access: VoiceAccess = { openAiKey, elevenLabsKey, elevenLabsFailure };
  const current = useVoiceSelection(role);
  const { previewing, loading, preview, stop } = usePreviewVoice();
  const providersRef = useRef<HTMLElement | null>(null);
  const goBack = useGoBack(ROUTES.settings);
  const sample = t('narrationVoices.sample');
  const focusProviders = params.get('focus') === 'providers';

  useEffect(() => {
    if (focusProviders) providersRef.current?.scrollIntoView({ block: 'start' });
  }, [focusProviders]);

  const setRole = (next: VoiceRole) => {
    stop();
    const p = new URLSearchParams(params);
    if (next === 'assistant') p.set('for', 'assistant');
    else p.delete('for');
    p.delete('focus');
    setParams(p, { replace: true });
  };

  /** The preview control for one voice, or none when it can't speak here. */
  const hear = (key: string, voice: SpeechVoice, name: string) => {
    if (voiceAvailability(role, voice, access) !== 'ok') return undefined;
    const active = previewing === key;
    return {
      state: active ? (loading ? 'loading' : 'playing') : ('idle' as const),
      label: t('narrationVoices.hearVoice', { name }) as string,
      onToggle: () => (active ? stop() : void preview(voice, locale, sample, key)),
    } as const;
  };

  const usage = (id: string): string | undefined => {
    const reads = selection.narration === id;
    const replies = selection.assistant === id;
    if (reads && replies) return t('narrationVoices.usage.both');
    if (reads) return t('narrationVoices.usage.reads');
    if (replies) return t('narrationVoices.usage.replies');
    return undefined;
  };

  const echoName = t('narrationVoices.system.echo');
  const deviceName = t('narrationVoices.system.device');
  const chosenProfile = findVoice(current.id, voices);
  const heroName =
    current.id === SYSTEM_ECHO_ID ? echoName : current.id === SYSTEM_DEVICE_ID ? deviceName : chosenProfile?.name ?? echoName;
  const reason = unavailableReason(current.availability, t);
  const speakingName =
    current.speaking.provider === 'device' ? deviceName : current.speaking === ECHO_VOICE ? echoName : heroName;
  const heroPreview = hear('hero', current.speaking, speakingName);

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center gap-2 px-4 py-2 border-b border-surface-raised/50 bg-surface/90 backdrop-blur">
        <button
          type="button"
          onClick={goBack}
          aria-label={t('common.back') as string}
          className="shrink-0 text-ink-muted hover:text-ink transition-colors -ml-1 px-1"
        >
          <ChevronIcon dir="left" size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-serif text-brand text-lg truncate">{t('narrationVoices.title')}</h1>
          <p className="text-[11px] text-ink-muted truncate">{t('narrationVoices.subtitleLine')}</p>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 pb-28 space-y-6">
        <SegmentedControl
          value={role}
          options={[
            { value: 'narration', label: t('narrationVoices.roles.reading') },
            { value: 'assistant', label: t('narrationVoices.roles.replies') },
          ]}
          onChange={setRole}
        />

        {/* The voice this role has chosen, and — when this session can't use
            it — the one actually speaking instead, and why. */}
        <section
          aria-label={t('narrationVoices.hero.label') as string}
          className="rounded-3xl border border-brand/25 bg-gradient-to-br from-brand/20 via-surface-raised/40 to-surface p-4 flex items-center gap-4"
        >
          <VoiceAvatar
            name={heroName}
            avatar={chosenProfile?.avatar}
            system={current.id === SYSTEM_ECHO_ID ? 'echo' : current.id === SYSTEM_DEVICE_ID ? 'device' : undefined}
            size={72}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wider text-brand">
              {role === 'narration' ? t('narrationVoices.hero.reads') : t('narrationVoices.hero.replies')}
            </p>
            <p className="font-serif text-xl text-ink truncate">{heroName}</p>
            <p className="text-xs text-ink-muted truncate">
              {voiceSubtitle(current.chosen, chosenProfile?.sourceName, t)}
            </p>
            {reason && (
              <p className="text-xs text-amber-400 mt-1">
                {t('narrationVoices.hero.fallback', { name: speakingName })} {reason}
              </p>
            )}
          </div>
          {heroPreview && (
            <button
              type="button"
              onClick={heroPreview.onToggle}
              aria-label={heroPreview.label}
              className="h-12 w-12 shrink-0 rounded-full bg-brand text-on-brand flex items-center justify-center active:scale-95 transition-transform"
            >
              {heroPreview.state === 'loading' ? (
                <SpinnerIcon size={18} />
              ) : heroPreview.state === 'playing' ? (
                <StopIcon size={16} />
              ) : (
                <SpeakerIcon size={20} />
              )}
            </button>
          )}
        </section>

        {!syncEnabled && (
          <p className="text-xs text-ink-muted leading-relaxed">
            {t('narrationVoices.syncOff')}{' '}
            <button type="button" className="text-brand underline" onClick={() => navigate(ROUTES.settings)}>
              {t('narrationVoices.syncOffLink')}
            </button>
          </p>
        )}

        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-2">
            {t('narrationVoices.sections.system')}
          </h2>
          <ul role="radiogroup" aria-label={t('narrationVoices.sections.system') as string} className="space-y-2">
            <VoiceTile
              name={echoName}
              subtitle={voiceSubtitle(ECHO_VOICE, undefined, t)}
              system="echo"
              selected={current.id === SYSTEM_ECHO_ID}
              locked={voiceAvailability(role, ECHO_VOICE, access) !== 'ok'}
              usage={usage(SYSTEM_ECHO_ID)}
              onSelect={() => void selectVoice(role, SYSTEM_ECHO_ID)}
              preview={hear(SYSTEM_ECHO_ID, ECHO_VOICE, echoName)}
            />
            <VoiceTile
              name={deviceName}
              subtitle={voiceSubtitle(DEVICE_VOICE, undefined, t)}
              system="device"
              selected={current.id === SYSTEM_DEVICE_ID}
              usage={usage(SYSTEM_DEVICE_ID)}
              onSelect={() => void selectVoice(role, SYSTEM_DEVICE_ID)}
              preview={hear(SYSTEM_DEVICE_ID, DEVICE_VOICE, deviceName)}
            />
          </ul>
        </section>

        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-2">
            {t('narrationVoices.sections.yours')}
          </h2>
          <ul role="radiogroup" aria-label={t('narrationVoices.sections.yours') as string} className="space-y-2">
            {voices.map((v) => (
              <VoiceTile
                key={v.id}
                name={v.name}
                subtitle={voiceSubtitle(v.config, v.sourceName, t)}
                avatar={v.avatar}
                selected={current.id === v.id}
                locked={voiceAvailability(role, v.config, access) !== 'ok'}
                usage={usage(v.id)}
                onSelect={() => void selectVoice(role, v.id)}
                preview={hear(v.id, v.config, v.name)}
                onEdit={() =>
                  navigate(`${ROUTES.voices}/${v.id}${role === 'assistant' ? '?for=assistant' : ''}`)
                }
                editLabel={t('narrationVoices.edit', { name: v.name }) as string}
              />
            ))}
          </ul>
          <button
            type="button"
            onClick={() => navigate(`${ROUTES.voices}/new${role === 'assistant' ? '?for=assistant' : ''}`)}
            className="mt-2 w-full flex items-center gap-3 rounded-2xl border-2 border-dashed border-brand/30 px-3 py-3 text-left hover:border-brand/60 hover:bg-brand/5 transition-colors"
          >
            <span className="h-11 w-11 rounded-full bg-brand/15 text-brand flex items-center justify-center shrink-0">
              <PlusIcon />
            </span>
            <span className="min-w-0">
              <span className="block font-serif text-[16px] text-ink">{t('narrationVoices.create')}</span>
              <span className="block text-xs text-ink-muted">{t('narrationVoices.createHint')}</span>
            </span>
          </button>
        </section>

        <section ref={providersRef} className="space-y-3 scroll-mt-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            {t('narrationVoices.sections.providers')}
          </h2>
          <p className="text-xs text-ink-muted leading-relaxed">{t('narrationVoices.providersHint')}</p>
          <OpenAiKeySection />
          <ElevenLabsKeySection />
        </section>
      </div>
    </div>
  );
}
