import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settingsStore';
import { getAmbientTracks, type AmbientTrack } from '@/services/api/ambient';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { StepHeading } from './StepHeading';

export function MusicStep() {
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
