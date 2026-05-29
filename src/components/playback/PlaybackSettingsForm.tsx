import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settingsStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { RATE_CYCLE } from '@/hooks/usePlaybackTransport';
import { getAmbientTracks, type AmbientTrack } from '@/services/api/ambient';
import { MsSlider } from '@/components/common/MsSlider';

export function PlaybackSettingsForm() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <FormSection title={t('settings.ambient.title')}>
        <MusicSettings />
      </FormSection>

      <FormSection title={t('playbackSheet.readingTitle')}>
        <ReadingSettings />
      </FormSection>

      <FormSection title={t('playbackSheet.announcementsTitle')}>
        <AnnouncementsSettings />
      </FormSection>
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-gold-dim mb-2">{title}</h3>
      {children}
    </div>
  );
}

function MusicSettings() {
  const { t } = useTranslation();
  const ambient = useSettingsStore((s) => s.ambient);
  const setAmbient = useSettingsStore((s) => s.setAmbient);
  const speechVolume = useSettingsStore((s) => s.speechVolume);
  const setSpeechVolume = useSettingsStore((s) => s.setSpeechVolume);

  const [tracks, setTracks] = useState<AmbientTrack[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    let alive = true;
    getAmbientTracks()
      .then((list) => {
        if (alive) setTracks(list);
      })
      .catch(() => {
        if (alive) {
          setTracks([]);
          setLoadError(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const selectedTrack = tracks?.find((tr) => tr.id === ambient.trackId) ?? null;

  const onPreview = async () => {
    if (!selectedTrack) return;
    audioPlayback.ensureContext();
    try {
      await audioPlayback.ambient.load(selectedTrack.url);
      audioPlayback.ambient.play();
      setPreviewing(true);
    } catch (e) {
      console.warn('ambient preview failed', e);
    }
  };
  const onStopPreview = () => {
    audioPlayback.ambient.pause();
    setPreviewing(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-cream-dim">{t('settings.ambient.hint')}</p>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={ambient.enabled}
          onChange={(e) => setAmbient({ enabled: e.target.checked })}
        />
        <span className="text-sm">{t('settings.ambient.enabled')}</span>
      </label>

      <div>
        <label className="block text-xs text-cream-dim mb-1">
          {t('settings.ambient.track')}
        </label>
        <div className="flex gap-2">
          <select
            value={ambient.trackId ?? ''}
            onChange={(e) => setAmbient({ trackId: e.target.value || null })}
            disabled={tracks === null}
            className="flex-1 bg-navy-soft text-cream rounded-xl px-3 py-2 disabled:opacity-50"
          >
            <option value="">
              {tracks === null
                ? t('settings.ambient.loading')
                : tracks.length === 0
                  ? t('settings.ambient.noneAvailable')
                  : t('settings.ambient.none')}
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
              {previewing ? t('settings.ambient.stop') : t('settings.ambient.preview')}
            </button>
          )}
        </div>
        {loadError && (
          <p className="mt-1 text-xs text-coral">{t('chat.errorGeneric')}</p>
        )}
      </div>

      <VolumeSlider
        label={t('settings.ambient.musicVolume')}
        value={ambient.volume}
        onChange={(v) => {
          setAmbient({ volume: v });
          audioPlayback.ambient.setVolume(v);
        }}
      />

      <VolumeSlider
        label={t('settings.ambient.speechVolume')}
        value={speechVolume}
        onChange={(v) => {
          setSpeechVolume(v);
          audioPlayback.speech.setVolume(v);
        }}
      />
    </div>
  );
}

function ReadingSettings() {
  const { t } = useTranslation();
  const autoScroll = useSettingsStore((s) => s.autoScrollReader);
  const setAutoScroll = useSettingsStore((s) => s.setAutoScrollReader);
  const autoPlay = useSettingsStore((s) => s.autoPlayReading);
  const setAutoPlay = useSettingsStore((s) => s.setAutoPlayReading);

  // Local mirrors of engine state — initialized on mount and kept in sync via
  // the click handlers below (this form is the only writer for rate/repeat).
  const [rate, setRate] = useState(() => audioPlayback.getPlaybackRate());
  const [repeat, setRepeat] = useState(() => audioPlayback.isLoopCurrent());

  return (
    <div className="space-y-3">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={autoPlay}
          onChange={(e) => setAutoPlay(e.target.checked)}
        />
        <span className="text-sm">
          {t('settings.autoPlay')}
          <span className="block text-xs text-cream-dim mt-0.5">
            {t('settings.autoPlayHint')}
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={autoScroll}
          onChange={(e) => setAutoScroll(e.target.checked)}
        />
        <span className="text-sm">
          {t('settings.autoScroll')}
          <span className="block text-xs text-cream-dim mt-0.5">
            {t('settings.autoScrollHint')}
          </span>
        </span>
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={repeat}
          onChange={(e) => {
            audioPlayback.setLoopCurrent(e.target.checked);
            setRepeat(e.target.checked);
          }}
        />
        <span className="text-sm">{t('chat.reader.repeat')}</span>
      </label>

      <div>
        <label className="block text-xs text-cream-dim mb-1">
          {t('chat.reader.rate')}
        </label>
        <div className="grid grid-cols-4 bg-navy-soft rounded-xl p-1">
          {RATE_CYCLE.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                audioPlayback.setPlaybackRate(r);
                setRate(r);
              }}
              className={
                'py-2 text-sm rounded-lg transition-colors font-mono ' +
                (rate === r
                  ? 'bg-gold text-navy'
                  : 'text-cream-dim hover:text-cream')
              }
            >
              {r.toFixed(2)}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AnnouncementsSettings() {
  const { t } = useTranslation();
  const readChapterHeadings = useSettingsStore((s) => s.readChapterHeadings);
  const setReadChapterHeadings = useSettingsStore((s) => s.setReadChapterHeadings);
  const readVerseNumbers = useSettingsStore((s) => s.readVerseNumbers);
  const setReadVerseNumbers = useSettingsStore((s) => s.setReadVerseNumbers);
  const verseNumberStyle = useSettingsStore((s) => s.verseNumberStyle);
  const setVerseNumberStyle = useSettingsStore((s) => s.setVerseNumberStyle);
  const pauseBetweenVersesMs = useSettingsStore((s) => s.pauseBetweenVersesMs);
  const setPauseBetweenVersesMs = useSettingsStore((s) => s.setPauseBetweenVersesMs);
  const pauseBetweenChaptersMs = useSettingsStore((s) => s.pauseBetweenChaptersMs);
  const setPauseBetweenChaptersMs = useSettingsStore((s) => s.setPauseBetweenChaptersMs);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={readChapterHeadings}
          onChange={(e) => setReadChapterHeadings(e.target.checked)}
        />
        <span className="text-sm">{t('settings.announceChapter')}</span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={readVerseNumbers}
          onChange={(e) => setReadVerseNumbers(e.target.checked)}
        />
        <span className="text-sm">{t('settings.announceVerseNumber')}</span>
      </label>

      {readVerseNumbers && (
        <div className="pl-6">
          <div className="grid grid-cols-2 bg-navy-soft rounded-xl p-1">
            {(['spoken', 'plain'] as const).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => setVerseNumberStyle(style)}
                title={
                  style === 'spoken'
                    ? (t('settings.verseStyleSpokenHint') as string)
                    : (t('settings.verseStylePlainHint') as string)
                }
                className={
                  'py-2 text-sm rounded-lg transition-colors ' +
                  (verseNumberStyle === style
                    ? 'bg-gold text-navy'
                    : 'text-cream-dim hover:text-cream')
                }
              >
                {style === 'spoken'
                  ? t('settings.verseStyleSpoken')
                  : t('settings.verseStylePlain')}
              </button>
            ))}
          </div>
        </div>
      )}

      <MsSlider
        label={t('settings.pauseBetweenVerses')}
        value={pauseBetweenVersesMs}
        max={3000}
        onChange={(v) => setPauseBetweenVersesMs(v)}
      />
      <MsSlider
        label={t('settings.pauseBetweenChapters')}
        value={pauseBetweenChaptersMs}
        max={6000}
        onChange={(v) => setPauseBetweenChaptersMs(v)}
      />
    </div>
  );
}

function VolumeSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="flex items-center justify-between text-xs text-cream-dim mb-1">
        <span>{label}</span>
        <span className="font-mono tabular-nums">{Math.round(value * 100)}%</span>
      </label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-gold"
      />
    </div>
  );
}

