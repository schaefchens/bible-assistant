import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { SpeakerIcon, SpinnerIcon, StopIcon } from '@/components/common/icons';
import {
  MAX_STYLE_BYTES,
  OPENAI_VOICES,
  clampStyle,
  styleBytes,
  type OpenAiVoiceId,
} from '@/services/voices/ttsVoice';
import { defaultVoiceName } from '@/services/voices/voiceProfiles';

/**
 * An OpenAI voice: which of the thirteen, and *how* it should read — the
 * style is passed to gpt-4o-mini-tts as instructions, after the app's own
 * "read this Bible passage in clear, reverent English/German".
 *
 * The presets insert a whole sentence rather than a keyword because
 * instructions are prose to the model, and a sentence is something the user
 * can see the effect of and then edit.
 */
export function OpenAiVoiceFields({
  voice,
  style,
  onVoice,
  onStyle,
  preview,
}: {
  voice: OpenAiVoiceId;
  style: string;
  onVoice: (v: OpenAiVoiceId) => void;
  onStyle: (s: string) => void;
  /** Hear a base voice as it is (no style) — null when this session can't. */
  preview: {
    state: (v: OpenAiVoiceId) => 'idle' | 'loading' | 'playing';
    toggle: (v: OpenAiVoiceId) => void;
  } | null;
}) {
  const { t } = useTranslation();
  // Literal keys, so the i18n scan can see every one.
  const blurbs: Record<OpenAiVoiceId, string> = {
    marin: t('narrationVoices.openai.blurb.marin'),
    cedar: t('narrationVoices.openai.blurb.cedar'),
    alloy: t('narrationVoices.openai.blurb.alloy'),
    ash: t('narrationVoices.openai.blurb.ash'),
    ballad: t('narrationVoices.openai.blurb.ballad'),
    coral: t('narrationVoices.openai.blurb.coral'),
    echo: t('narrationVoices.openai.blurb.echo'),
    fable: t('narrationVoices.openai.blurb.fable'),
    nova: t('narrationVoices.openai.blurb.nova'),
    onyx: t('narrationVoices.openai.blurb.onyx'),
    sage: t('narrationVoices.openai.blurb.sage'),
    shimmer: t('narrationVoices.openai.blurb.shimmer'),
    verse: t('narrationVoices.openai.blurb.verse'),
  };
  const presets = [
    { label: t('narrationVoices.style.reverent'), text: t('narrationVoices.style.reverentText') },
    { label: t('narrationVoices.style.storyteller'), text: t('narrationVoices.style.storytellerText') },
    { label: t('narrationVoices.style.calm'), text: t('narrationVoices.style.calmText') },
    { label: t('narrationVoices.style.bright'), text: t('narrationVoices.style.brightText') },
    { label: t('narrationVoices.style.dramatic'), text: t('narrationVoices.style.dramaticText') },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm text-ink mb-2">{t('narrationVoices.openai.voice')}</h3>
        <div role="radiogroup" aria-label={t('narrationVoices.openai.voice') as string} className="grid grid-cols-2 gap-2">
          {OPENAI_VOICES.map((v) => {
            const selected = v === voice;
            const best = v === 'marin' || v === 'cedar';
            const state = preview?.state(v) ?? 'idle';
            return (
              <div
                key={v}
                className={clsx(
                  'relative flex items-center rounded-xl border transition-colors',
                  selected
                    ? 'border-brand/60 bg-brand/15'
                    : 'border-surface-raised bg-surface-raised/40 hover:border-brand/30',
                )}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onVoice(v)}
                  className="flex-1 min-w-0 text-left pl-3 py-2"
                >
                  <span className="flex items-center gap-1.5">
                    <span className={clsx('text-sm', selected ? 'text-brand' : 'text-ink')}>
                      {defaultVoiceName({ provider: 'openai', voice: v, style: '' })}
                    </span>
                    {best && (
                      <span className="px-1.5 rounded-full text-[9px] uppercase tracking-wider bg-brand text-on-brand">
                        {t('narrationVoices.openai.best')}
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] text-ink-muted truncate">{blurbs[v]}</span>
                </button>
                {preview && (
                  <button
                    type="button"
                    onClick={() => preview.toggle(v)}
                    aria-label={t('narrationVoices.hearVoice', {
                      name: defaultVoiceName({ provider: 'openai', voice: v, style: '' }),
                    }) as string}
                    className="h-8 w-8 mr-1 shrink-0 rounded-full flex items-center justify-center text-brand hover:bg-brand/10"
                  >
                    {state === 'loading' ? (
                      <SpinnerIcon size={14} />
                    ) : state === 'playing' ? (
                      <StopIcon size={12} />
                    ) : (
                      <SpeakerIcon size={15} />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor="voice-style" className="block text-sm text-ink mb-1">
          {t('narrationVoices.style.title')}
        </label>
        <p className="text-xs text-ink-muted mb-2">{t('narrationVoices.style.hint')}</p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => onStyle(p.text)}
              aria-pressed={style === p.text}
              className={clsx(
                'px-2.5 py-1 rounded-full text-xs border transition-colors',
                style === p.text
                  ? 'border-brand/60 bg-brand/15 text-brand'
                  : 'border-surface-raised bg-surface-raised/40 text-ink-muted hover:text-ink',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <textarea
          id="voice-style"
          value={style}
          onChange={(e) => onStyle(clampStyle(e.target.value))}
          rows={3}
          placeholder={t('narrationVoices.style.placeholder') as string}
          className="w-full bg-surface-raised text-ink rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/60 resize-y"
        />
        <p className="text-[11px] text-ink-muted text-right tabular-nums">
          {styleBytes(style)}/{MAX_STYLE_BYTES}
        </p>
      </div>
    </div>
  );
}
