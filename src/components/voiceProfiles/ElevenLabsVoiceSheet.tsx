import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BottomSheet, BottomSheetBody } from '@/components/common/BottomSheet';
import { SpeakerIcon, SpinnerIcon, StopIcon } from '@/components/common/icons';
import { usePreviewVoice } from '@/hooks/usePreviewVoice';
import {
  listElevenLabsVoices,
  type ElevenLabsLibraryVoice,
} from '@/services/api/elevenlabs';
import { isElevenLabsVoiceId } from '@/services/voices/ttsVoice';

type Page = {
  /** The search this answers — while it differs from the input's, a new page
   * is on its way, which is all "loading" means here. */
  query: string;
  voices: ElevenLabsLibraryVoice[];
  next: string | null;
  failed: boolean;
};

/**
 * Pick a voice from the user's own ElevenLabs library — the premade voices
 * every account has, plus any they designed or cloned on ElevenLabs.
 *
 * Every row plays ElevenLabs' own sample, which is free; choosing one costs
 * nothing either. Credits are only spent once it reads something.
 *
 * Fetched when opened (the sheet is always mounted), searched after a short
 * pause in typing, paged with "load more".
 *
 * A voice can also be named by its id. That is the way in for a key without
 * the "Voices (read)" permission — listing is refused, narrating is not — and
 * for a voice found on the ElevenLabs website that is not in the library.
 */
export function ElevenLabsVoiceSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (voice: ElevenLabsLibraryVoice) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<Page | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [byId, setById] = useState('');
  const { previewing, loading: previewLoading, previewUrl, stop } = usePreviewVoice();

  // Debounced: a request per keystroke would page through ElevenLabs for
  // every letter of "George".
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listElevenLabsVoices({ search: query || undefined, pageSize: 30 })
      .then((r) => {
        if (!cancelled) {
          setPage({ query, voices: r.voices, next: r.hasMore ? r.nextPageToken : null, failed: false });
        }
      })
      .catch(() => {
        if (!cancelled) setPage({ query, voices: [], next: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [open, query]);

  const loading = open && page?.query !== query;

  const loadMore = async () => {
    if (!page?.next) return;
    setLoadingMore(true);
    try {
      const r = await listElevenLabsVoices({
        search: page.query || undefined,
        pageSize: 30,
        nextPageToken: page.next,
      });
      setPage((p) =>
        p && p.query === page.query
          ? { ...p, voices: [...p.voices, ...r.voices], next: r.hasMore ? r.nextPageToken : null }
          : p,
      );
    } catch {
      /* the button stays; try again */
    } finally {
      setLoadingMore(false);
    }
  };

  const close = () => {
    stop();
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={close} title={t('narrationVoices.elevenlabs.libraryTitle')}>
      <BottomSheetBody>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('narrationVoices.elevenlabs.search') as string}
          aria-label={t('narrationVoices.elevenlabs.search') as string}
          className="w-full bg-surface-raised text-ink rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/60 mb-3"
        />
        {loading ? (
          <div className="py-10 flex justify-center text-brand">
            <SpinnerIcon />
          </div>
        ) : page?.failed ? (
          <p className="py-8 text-center text-sm text-ink-muted">
            {t('narrationVoices.elevenlabs.libraryFailed')}{' '}
            {t('narrationVoices.elevenlabs.libraryFailedHint')}
          </p>
        ) : !page || page.voices.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">
            {t('narrationVoices.elevenlabs.libraryEmpty')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {page.voices.map((v) => {
              const labels = [v.labels.gender, v.labels.age, v.labels.accent, v.labels.useCase]
                .filter(Boolean)
                .join(' · ');
              const speaksGerman = v.languages.some((l) => l.language === 'de');
              const playing = previewing === v.voiceId;
              return (
                <li
                  key={v.voiceId}
                  className="flex items-center gap-1 rounded-xl border border-surface-raised/70 bg-surface-raised/30 pr-1"
                >
                  <button
                    type="button"
                    onClick={() => {
                      stop();
                      onPick(v);
                    }}
                    className="flex-1 min-w-0 text-left px-3 py-2"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm text-ink truncate">{v.name}</span>
                      <span className="shrink-0 px-1.5 rounded text-[10px] bg-surface text-ink-muted">
                        {v.category}
                      </span>
                      {speaksGerman && (
                        <span className="shrink-0 px-1.5 rounded text-[10px] font-mono bg-brand/15 text-brand">
                          DE
                        </span>
                      )}
                    </span>
                    {labels && <span className="block text-[11px] text-ink-muted truncate">{labels}</span>}
                  </button>
                  {v.previewUrl && (
                    <button
                      type="button"
                      onClick={() => (playing ? stop() : previewUrl(v.previewUrl!, v.voiceId))}
                      aria-label={t('narrationVoices.hearVoice', { name: v.name }) as string}
                      className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-brand hover:bg-brand/10"
                    >
                      {playing && previewLoading ? (
                        <SpinnerIcon size={15} />
                      ) : playing ? (
                        <StopIcon size={12} />
                      ) : (
                        <SpeakerIcon size={16} />
                      )}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {page?.next && !loading && (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="btn-ghost w-full mt-3 text-xs"
          >
            {loadingMore ? t('narrationVoices.elevenlabs.loadingMore') : t('narrationVoices.elevenlabs.loadMore')}
          </button>
        )}
        <form
          className="mt-5 pt-4 border-t border-surface-raised/60"
          onSubmit={(e) => {
            e.preventDefault();
            const voiceId = byId.trim();
            if (!isElevenLabsVoiceId(voiceId)) return;
            stop();
            setById('');
            onPick({
              voiceId,
              name: '',
              category: 'id',
              labels: {},
              description: null,
              previewUrl: null,
              languages: [],
              isOwner: false,
            });
          }}
        >
          <label htmlFor="elevenlabs-voice-id" className="block text-xs text-ink-muted mb-1.5">
            {t('narrationVoices.elevenlabs.byIdHint')}
          </label>
          <div className="flex gap-2">
            <input
              id="elevenlabs-voice-id"
              value={byId}
              onChange={(e) => setById(e.target.value)}
              placeholder="JBFqnCBsd6RMkjVDRZzb"
              spellCheck={false}
              autoComplete="off"
              className="flex-1 min-w-0 bg-surface-raised text-ink rounded-xl px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-brand/60"
            />
            <button
              type="submit"
              disabled={!isElevenLabsVoiceId(byId.trim())}
              className="btn-ghost text-xs disabled:opacity-50"
            >
              {t('narrationVoices.elevenlabs.useId')}
            </button>
          </div>
        </form>
      </BottomSheetBody>
    </BottomSheet>
  );
}
