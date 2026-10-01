import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { BottomSheet, BottomSheetBody } from '@/components/common/BottomSheet';
import { CheckIcon, SparkleIcon, SpeakerIcon, SpinnerIcon, StopIcon } from '@/components/common/icons';
import { usePreviewVoice } from '@/hooks/usePreviewVoice';
import { useLocale } from '@/hooks/useLocale';
import { extractErrorDetail } from '@/lib/extractErrorDetail';
import {
  designElevenLabsVoice,
  type DesignedVoicePreview,
} from '@/services/api/elevenlabs';

const MAX_DESCRIPTION = 1000;
/** ElevenLabs refuses a shorter description outright. */
const MIN_DESCRIPTION = 20;

/**
 * Describe a voice in words and choose from three ElevenLabs makes of it —
 * "a warm, elderly man, gentle and wise, reading by the fire".
 *
 * The previews read Psalm 23 (api.php supplies the text, in the UI language),
 * so what is auditioned is what reading scripture in it sounds like. Choosing
 * one does not save anything yet: the editor's Save adds it to the user's
 * ElevenLabs library, which is when it gets a voice id.
 *
 * Generating spends the user's ElevenLabs credits, which the button says.
 */
export function VoiceDesignSheet({
  open,
  onClose,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  onChoose: (chosen: { preview: DesignedVoicePreview; description: string }) => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ description: string; previews: DesignedVoicePreview[] } | null>(
    null,
  );
  const [picked, setPicked] = useState<string | null>(null);
  const { previewing, previewUrl, stop } = usePreviewVoice();

  const examples = [
    t('narrationVoices.design.example1'),
    t('narrationVoices.design.example2'),
    t('narrationVoices.design.example3'),
  ];

  const generate = async () => {
    const text = description.trim();
    if (text.length < MIN_DESCRIPTION) return;
    stop();
    setBusy(true);
    setError(null);
    setPicked(null);
    try {
      const r = await designElevenLabsVoice({ description: text, language: locale });
      setResult({ description: text, previews: r.previews });
    } catch (e) {
      setError(extractErrorDetail(e) ?? t('narrationVoices.design.failed'));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    stop();
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={close} title={t('narrationVoices.design.title')}>
      <BottomSheetBody>
        <p className="text-xs text-ink-muted mb-3 leading-relaxed">{t('narrationVoices.design.intro')}</p>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
          rows={3}
          placeholder={t('narrationVoices.design.placeholder') as string}
          aria-label={t('narrationVoices.design.title') as string}
          className="w-full bg-surface-raised text-ink rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/60 resize-y"
        />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setDescription(ex)}
              className="px-2.5 py-1 rounded-full text-xs border border-surface-raised bg-surface-raised/40 text-ink-muted hover:text-ink text-left"
            >
              {ex}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy || description.trim().length < MIN_DESCRIPTION}
          className="btn-primary w-full mt-4 disabled:opacity-50"
        >
          {busy ? <SpinnerIcon size={16} /> : <SparkleIcon />}
          {busy ? t('narrationVoices.design.generating') : t('narrationVoices.design.generate')}
        </button>
        <p className="text-[11px] text-ink-muted text-center mt-1">
          {description.trim().length < MIN_DESCRIPTION
            ? t('narrationVoices.design.tooShort')
            : t('narrationVoices.design.cost')}
        </p>
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

        {result && result.previews.length > 0 && (
          <div className="mt-5 space-y-2">
            <h3 className="text-sm text-ink">{t('narrationVoices.design.choose')}</h3>
            {result.previews.map((p, i) => {
              const playing = previewing === p.generatedVoiceId;
              const chosen = picked === p.generatedVoiceId;
              return (
                <div
                  key={p.generatedVoiceId}
                  className={clsx(
                    'flex items-center gap-2 rounded-xl border px-2 py-2',
                    chosen ? 'border-brand/60 bg-brand/10' : 'border-surface-raised/70 bg-surface-raised/30',
                  )}
                >
                  <button
                    type="button"
                    onClick={() =>
                      playing
                        ? stop()
                        : previewUrl(`data:${p.mediaType};base64,${p.audioBase64}`, p.generatedVoiceId)
                    }
                    aria-label={t('narrationVoices.design.hearOption', { n: i + 1 }) as string}
                    className="h-10 w-10 shrink-0 rounded-full bg-brand/15 text-brand flex items-center justify-center"
                  >
                    {playing ? <StopIcon size={13} /> : <SpeakerIcon />}
                  </button>
                  <span className="flex-1 text-sm text-ink">
                    {t('narrationVoices.design.option', { n: i + 1 })}
                    <span className="text-xs text-ink-muted"> · {Math.round(p.durationSecs)} s</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(p.generatedVoiceId);
                      stop();
                      onChoose({ preview: p, description: result.description });
                    }}
                    className={clsx('text-xs px-3 py-1.5 rounded-lg', chosen ? 'bg-brand text-on-brand' : 'btn-ghost')}
                  >
                    {chosen ? <CheckIcon size={14} /> : t('narrationVoices.design.use')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
