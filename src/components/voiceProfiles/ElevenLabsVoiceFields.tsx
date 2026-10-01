import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { RangeSlider } from '@/components/common/RangeSlider';
import { ListIcon, SparkleIcon } from '@/components/common/icons';
import {
  ELEVEN_SPEED_MAX,
  ELEVEN_SPEED_MIN,
  type ElevenModel,
} from '@/services/voices/ttsVoice';
import type { VoiceDraftState } from './voiceDraft';
import { ElevenLabsVoiceSheet } from './ElevenLabsVoiceSheet';
import { VoiceDesignSheet } from './VoiceDesignSheet';

type Fields = VoiceDraftState['elevenlabs'];

/**
 * An ElevenLabs voice: *which* voice (from the user's library, or designed
 * from a description), on which model, delivered how.
 *
 * Two models, because they are genuinely different instruments: Eleven v4 is
 * the most expressive there is and takes stability and similarity only;
 * Multilingual v2 is the steadiest over a long reading and adds style and
 * speed. The sliders a model does not have are hidden rather than disabled —
 * and never saved, so they cannot become part of the voice's identity.
 */
export function ElevenLabsVoiceFields({
  value,
  onChange,
  disabled,
}: {
  value: Fields;
  onChange: (patch: Partial<Fields>) => void;
  /** No ElevenLabs key: the library and the designer have nothing to ask. */
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [designOpen, setDesignOpen] = useState(false);
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  const models: { value: ElevenModel; label: string; hint: string }[] = [
    { value: 'eleven_v4', label: t('narrationVoices.elevenlabs.v4'), hint: t('narrationVoices.elevenlabs.v4Hint') },
    {
      value: 'eleven_multilingual_v2',
      label: t('narrationVoices.elevenlabs.v2'),
      hint: t('narrationVoices.elevenlabs.v2Hint'),
    },
  ];

  const chosenName = value.pendingDesign
    ? t('narrationVoices.elevenlabs.designedPending')
    : value.sourceName || (value.voiceId ? value.voiceId : null);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm text-ink mb-2">{t('narrationVoices.elevenlabs.voice')}</h3>
        <div className="rounded-xl bg-surface-raised/40 border border-surface-raised px-3 py-2 mb-2">
          <p className={clsx('text-sm', chosenName ? 'text-ink' : 'text-ink-muted')}>
            {chosenName ?? t('narrationVoices.elevenlabs.noneChosen')}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setLibraryOpen(true)}
            className="btn-ghost text-xs disabled:opacity-50"
          >
            <ListIcon size={15} />
            {t('narrationVoices.elevenlabs.fromLibrary')}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setDesignOpen(true)}
            className="btn-ghost text-xs disabled:opacity-50"
          >
            <SparkleIcon size={15} />
            {t('narrationVoices.elevenlabs.design')}
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm text-ink mb-2">{t('narrationVoices.elevenlabs.model')}</h3>
        <div role="radiogroup" aria-label={t('narrationVoices.elevenlabs.model') as string} className="space-y-2">
          {models.map((m) => {
            const selected = value.model === m.value;
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ model: m.value })}
                className={clsx(
                  'w-full text-left rounded-xl border px-3 py-2 transition-colors',
                  selected
                    ? 'border-brand/60 bg-brand/15'
                    : 'border-surface-raised bg-surface-raised/40 hover:border-brand/30',
                )}
              >
                <span className={clsx('block text-sm', selected ? 'text-brand' : 'text-ink')}>{m.label}</span>
                <span className="block text-[11px] text-ink-muted">{m.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <RangeSlider
          label={t('narrationVoices.elevenlabs.stability')}
          hint={t('narrationVoices.elevenlabs.stabilityHint')}
          value={value.stability}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={(stability) => onChange({ stability })}
        />
        <RangeSlider
          label={t('narrationVoices.elevenlabs.similarity')}
          hint={t('narrationVoices.elevenlabs.similarityHint')}
          value={value.similarity}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={(similarity) => onChange({ similarity })}
        />
        {value.model === 'eleven_multilingual_v2' && (
          <>
            <RangeSlider
              label={t('narrationVoices.elevenlabs.style')}
              hint={t('narrationVoices.elevenlabs.styleHint')}
              value={value.style}
              min={0}
              max={1}
              step={0.05}
              format={pct}
              onChange={(style) => onChange({ style })}
            />
            <RangeSlider
              label={t('narrationVoices.elevenlabs.speed')}
              value={value.speed}
              min={ELEVEN_SPEED_MIN}
              max={ELEVEN_SPEED_MAX}
              step={0.05}
              format={(v) => `×${v.toFixed(2)}`}
              onChange={(speed) => onChange({ speed })}
            />
          </>
        )}
      </div>

      <ElevenLabsVoiceSheet
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onPick={(v) => {
          setLibraryOpen(false);
          onChange({
            voiceId: v.voiceId,
            sourceName: v.name,
            previewUrl: v.previewUrl,
            pendingDesign: undefined,
          });
        }}
      />
      <VoiceDesignSheet
        open={designOpen}
        onClose={() => setDesignOpen(false)}
        onChoose={({ preview, description }) => {
          setDesignOpen(false);
          onChange({
            voiceId: null,
            sourceName: '',
            previewUrl: null,
            pendingDesign: {
              generatedVoiceId: preview.generatedVoiceId,
              description,
              audioBase64: preview.audioBase64,
            },
          });
        }}
      />
    </div>
  );
}
