import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import {
  CameraIcon,
  ChevronIcon,
  LockIcon,
  SpeakerIcon,
  SpinnerIcon,
  StopIcon,
  TrashIcon,
} from '@/components/common/icons';
import { useBottomBarHeight } from '@/hooks/useBottomBarHeight';
import { usePreviewVoice } from '@/hooks/usePreviewVoice';
import { useLocale } from '@/hooks/useLocale';
import { avatarDataUrl } from '@/lib/imageResize';
import { extractErrorDetail } from '@/lib/extractErrorDetail';
import { ROUTES } from '@/lib/appRoutes';
import { saveDesignedVoice } from '@/services/api/elevenlabs';
import { deleteNarrationForVoice } from '@/services/narration/narrationDownload';
import { ECHO_VOICE, sameTtsVoice, type OpenAiVoiceId } from '@/services/voices/ttsVoice';
import {
  MAX_AVATAR_CHARS,
  MAX_VOICE_NAME,
  defaultVoiceName,
  voiceAccessOf,
  voiceAvailability,
  type VoiceProfile,
  type VoiceRole,
} from '@/services/voices/voiceProfiles';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { draftConfig, draftFrom, type VoiceDraftState } from './voiceDraft';
import { VoiceAvatar } from './VoiceAvatar';
import { OpenAiVoiceFields } from './OpenAiVoiceFields';
import { ElevenLabsVoiceFields } from './ElevenLabsVoiceFields';

/**
 * Create or edit one narration voice: its face and name, its provider, and how
 * it speaks — with a sample to hear before saving.
 *
 * Works on a local draft and commits on Save, so a session of slider-fiddling
 * is one synced write rather than one per movement. Rendered with
 * `key={id}` by the route, so switching voices starts a fresh draft without an
 * effect copying props into state.
 *
 * Saving is allowed whether or not this session can *speak* in the voice: a
 * voice set up before its key is added is kept (and synced), and reads in Echo
 * — or the device voice, for replies — until the key arrives.
 */
export function VoiceEditor({
  profile,
  role,
  onDone,
}: {
  profile?: VoiceProfile;
  /** The role the user came from; a *new* voice is selected for it on Save. */
  role: VoiceRole;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const locale = useLocale();
  const voices = useLibraryStore((s) => s.voices);
  const createVoice = useLibraryStore((s) => s.createVoice);
  const updateVoice = useLibraryStore((s) => s.updateVoice);
  const deleteVoice = useLibraryStore((s) => s.deleteVoice);
  const selectVoice = useLibraryStore((s) => s.selectVoice);
  const hasOpenAiKey = useSettingsStore((s) => s.hasUserOpenAiKey && !s.sessionPreferSharedKey);
  const hasElevenLabsKey = useSettingsStore((s) => s.hasUserElevenLabsKey);
  const elevenLabsFailure = useSettingsStore((s) => s.elevenLabsFailure);
  const access = voiceAccessOf({
    hasUserOpenAiKey: hasOpenAiKey,
    sessionPreferSharedKey: false,
    hasUserElevenLabsKey: hasElevenLabsKey,
    elevenLabsFailure,
  });

  const [draft, setDraft] = useState<VoiceDraftState>(() =>
    draftFrom(profile, !hasOpenAiKey && hasElevenLabsKey ? 'elevenlabs' : 'openai'),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  useBottomBarHeight(barRef);
  const { previewing, loading, preview, previewUrl, stop } = usePreviewVoice();

  const config = draftConfig(draft);
  const availability = config ? voiceAvailability(role, config, access) : null;
  const providerLocked = draft.provider === 'openai' ? !hasOpenAiKey : !hasElevenLabsKey;
  const sample = t('narrationVoices.sample');

  const patchElevenLabs = (patch: Partial<VoiceDraftState['elevenlabs']>) =>
    setDraft((d) => ({ ...d, elevenlabs: { ...d.elevenlabs, ...patch } }));

  const pickAvatar = async (file?: File) => {
    if (!file) return;
    try {
      const avatar = await avatarDataUrl(file, 256, MAX_AVATAR_CHARS);
      setDraft((d) => ({ ...d, avatar }));
    } catch {
      setError(t('narrationVoices.editor.imageFailed'));
    }
  };

  /** What "Hear a sample" can play right now, or why not. */
  const sampleState: 'ok' | 'pending-design' | 'locked' | 'no-voice' = draft.provider ===
    'elevenlabs' && draft.elevenlabs.pendingDesign
    ? 'pending-design'
    : !config
      ? 'no-voice'
      : availability === 'ok'
        ? 'ok'
        : 'locked';

  const hearSample = () => {
    if (previewing) return stop();
    if (sampleState === 'pending-design' && draft.elevenlabs.pendingDesign) {
      previewUrl(`data:audio/mpeg;base64,${draft.elevenlabs.pendingDesign.audioBase64}`, 'sample');
    } else if (sampleState === 'ok' && config) {
      void preview(config, locale, sample, 'sample');
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    stop();
    try {
      let d = draft;
      const pending = d.provider === 'elevenlabs' ? d.elevenlabs.pendingDesign : undefined;
      if (pending) {
        // A designed voice only becomes usable once it is in the user's
        // ElevenLabs library — that is what gives it an id to narrate with.
        const name = d.name.trim() || t('narrationVoices.design.defaultName');
        const r = await saveDesignedVoice({
          generatedVoiceId: pending.generatedVoiceId,
          name,
          description: pending.description,
        });
        d = {
          ...d,
          elevenlabs: {
            ...d.elevenlabs,
            voiceId: r.voice.voiceId,
            sourceName: r.voice.name,
            previewUrl: r.voice.previewUrl,
            pendingDesign: undefined,
          },
        };
        setDraft(d);
      }
      const next = draftConfig(d);
      if (!next) {
        setError(t('narrationVoices.editor.pickVoice'));
        return;
      }
      const name =
        d.name.trim().slice(0, MAX_VOICE_NAME) ||
        (d.provider === 'elevenlabs' && d.elevenlabs.sourceName) ||
        defaultVoiceName(next);
      const sourceName = d.provider === 'elevenlabs' ? d.elevenlabs.sourceName || undefined : undefined;
      if (profile) {
        await updateVoice(profile.id, { name, avatar: d.avatar, sourceName, config: next });
      } else {
        const id = await createVoice({ name, avatar: d.avatar, sourceName, config: next });
        await selectVoice(role, id);
      }
      onDone();
    } catch (e) {
      setError(extractErrorDetail(e) ?? t('narrationVoices.editor.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!profile) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 4000);
      return;
    }
    stop();
    // Its downloads go too — unless another voice sounds exactly the same
    // (two profiles of one voice, or one that *is* Echo), whose audio is the
    // very same files.
    const shared =
      sameTtsVoice(profile.config, ECHO_VOICE) ||
      voices.some((v) => v.id !== profile.id && sameTtsVoice(v.config, profile.config));
    await deleteVoice(profile.id);
    if (!shared) void deleteNarrationForVoice(profile.config);
    onDone();
  };

  const displayName = draft.name.trim() || (config ? defaultVoiceName(config) : '');

  return (
    <div className="relative flex flex-col h-full min-h-0">
      <header className="flex items-center justify-between gap-2 px-4 py-2 border-b border-surface-raised/50 bg-surface/90 backdrop-blur">
        <button
          type="button"
          onClick={onDone}
          aria-label={t('common.back') as string}
          className="shrink-0 text-ink-muted hover:text-ink transition-colors -ml-1 px-1"
        >
          <ChevronIcon dir="left" size={20} />
        </button>
        <h1 className="flex-1 min-w-0 font-serif text-brand text-lg truncate">
          {profile ? t('narrationVoices.editor.editTitle') : t('narrationVoices.editor.newTitle')}
        </h1>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="h-9 px-4 shrink-0 rounded-lg bg-brand text-on-brand text-sm active:scale-95 transition-transform disabled:opacity-60"
        >
          {saving ? t('narrationVoices.editor.saving') : t('narrationVoices.editor.save')}
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5 pb-40 space-y-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label={t('narrationVoices.editor.avatar') as string}
            className="relative shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-brand/60"
          >
            <VoiceAvatar name={displayName} avatar={draft.avatar} size={88} />
            <span className="absolute -bottom-0.5 -right-0.5 h-8 w-8 rounded-full bg-brand text-on-brand flex items-center justify-center ring-2 ring-surface">
              <CameraIcon size={15} />
            </span>
          </button>
          {/* accept without `capture` opens the system photo picker, which
              needs no camera permission on either platform (as CommunitySection). */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void pickAvatar(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <div className="flex-1 min-w-0 space-y-1.5">
            <label htmlFor="voice-name" className="block text-xs text-ink-muted">
              {t('narrationVoices.editor.name')}
            </label>
            <input
              id="voice-name"
              value={draft.name}
              maxLength={MAX_VOICE_NAME}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder={t('narrationVoices.editor.namePlaceholder') as string}
              className="w-full bg-surface-raised text-ink rounded-xl px-3 py-2 font-serif text-lg outline-none focus:ring-2 focus:ring-brand/60"
            />
            {draft.avatar && (
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, avatar: undefined }))}
                className="text-xs text-ink-muted underline"
              >
                {t('narrationVoices.editor.removeAvatar')}
              </button>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-sm text-ink mb-2">{t('narrationVoices.editor.provider')}</h3>
          <SegmentedControl
            value={draft.provider}
            options={[
              { value: 'openai', label: 'OpenAI' },
              { value: 'elevenlabs', label: 'ElevenLabs' },
            ]}
            onChange={(provider) => {
              stop();
              setDraft((d) => ({ ...d, provider }));
            }}
          />
          {providerLocked && (
            <button
              type="button"
              onClick={() => navigate(`${ROUTES.voices}?focus=providers`)}
              className="mt-2 w-full flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-left text-xs text-ink"
            >
              <LockIcon className="shrink-0 text-amber-400" />
              <span className="flex-1">
                {draft.provider === 'openai'
                  ? t('narrationVoices.editor.needsOpenAiKey')
                  : t('narrationVoices.editor.needsElevenLabsKey')}
              </span>
              <ChevronIcon size={14} />
            </button>
          )}
        </div>

        {draft.provider === 'openai' ? (
          <OpenAiVoiceFields
            voice={draft.openai.voice}
            style={draft.openai.style}
            onVoice={(voice: OpenAiVoiceId) => setDraft((d) => ({ ...d, openai: { ...d.openai, voice } }))}
            onStyle={(style) => setDraft((d) => ({ ...d, openai: { ...d.openai, style } }))}
            preview={
              hasOpenAiKey
                ? {
                    state: (v) =>
                      previewing === `base:${v}` ? (loading ? 'loading' : 'playing') : 'idle',
                    toggle: (v) =>
                      previewing === `base:${v}`
                        ? stop()
                        : void preview(
                            { provider: 'openai', voice: v, style: '' },
                            locale,
                            sample,
                            `base:${v}`,
                          ),
                  }
                : null
            }
          />
        ) : (
          <ElevenLabsVoiceFields
            value={draft.elevenlabs}
            onChange={patchElevenLabs}
            disabled={!hasElevenLabsKey}
          />
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        {profile && (
          <button
            type="button"
            onClick={() => void remove()}
            className={clsx(
              'w-full flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm border',
              confirmingDelete
                ? 'text-red-400 border-red-500/60 bg-red-500/10'
                : 'text-red-400 border-red-500/40',
            )}
          >
            <TrashIcon size={16} />
            {confirmingDelete
              ? t('narrationVoices.editor.confirmDelete')
              : t('narrationVoices.editor.delete')}
          </button>
        )}
      </div>

      <div
        ref={barRef}
        className="absolute inset-x-0 bottom-0 px-4 pt-3 pb-4 pb-safe bg-surface/95 backdrop-blur border-t border-surface-raised/60"
      >
        <button
          type="button"
          onClick={hearSample}
          disabled={sampleState === 'locked' || sampleState === 'no-voice'}
          className="w-full btn-ghost border border-brand/30 disabled:opacity-50"
        >
          {previewing === 'sample' && loading ? (
            <SpinnerIcon size={16} />
          ) : previewing === 'sample' ? (
            <StopIcon size={13} />
          ) : (
            <SpeakerIcon />
          )}
          {previewing === 'sample' ? t('narrationVoices.editor.stopSample') : t('narrationVoices.editor.hearSample')}
        </button>
        <p className="mt-1 text-center text-[11px] text-ink-muted">
          {sampleState === 'locked'
            ? t('narrationVoices.editor.sampleLocked')
            : sampleState === 'no-voice'
              ? t('narrationVoices.editor.pickVoice')
              : draft.provider === 'elevenlabs' && sampleState === 'ok'
                ? t('narrationVoices.editor.sampleCost', { chars: sample.length })
                : t('narrationVoices.editor.sampleHint')}
        </p>
      </div>
    </div>
  );
}
