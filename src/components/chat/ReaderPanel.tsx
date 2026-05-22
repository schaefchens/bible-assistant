import { useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/store/chatStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useSettingsStore } from '@/store/settingsStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { startPlaybackForVerses } from '@/lib/startPlayback';
import { useCommandPipeline, useContinueReading } from '@/hooks/useCommandPipeline';
import { WordHighlighter } from '@/components/playback/WordHighlighter';
import { getBookById } from '@/services/bible/bookCatalog';
import { ReaderControls } from './ReaderControls';
import { MessageActionsMenu, type MessageActionItem } from './MessageActionsMenu';
import type { ChatMessage } from '@/types/domain';

type Props = {
  message: ChatMessage;
  selected: boolean;
  onSelect: () => void;
};

const RATE_CYCLE = [0.85, 1.0, 1.15, 1.3];

export function ReaderPanel({ message, selected, onSelect }: Props) {
  const { t, i18n } = useTranslation();
  const current = usePlaybackStore((s) => s.current);
  const status = usePlaybackStore((s) => s.status);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const highlightedId = useChatStore((s) => s.highlightedMessageId);
  const isHighlighted = highlightedId === message.id;
  const { send } = useCommandPipeline();
  const cont = useContinueReading(message, send);

  const [rate, setRate] = useState(() => audioPlayback.getPlaybackRate());
  const [repeat, setRepeat] = useState(() => audioPlayback.isLoopCurrent());
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const ambientCfg = useSettingsStore((s) => s.ambient);
  const ambientReady = ambientCfg.enabled && !!ambientCfg.trackId;
  const ambientOn = usePlaybackStore((s) => s.ambientPlaying);
  const autoScroll = useSettingsStore((s) => s.autoScrollReader);
  const setAutoScroll = useSettingsStore((s) => s.setAutoScrollReader);

  const isOurMessage = current?.messageId === message.id;
  const isPlaying = isOurMessage && status === 'playing';
  const isLoading = isOurMessage && status === 'loading';

  const toggleAmbient = useCallback(() => {
    if (audioPlayback.ambient.isPlaying()) {
      audioPlayback.ambient.pause();
    } else {
      audioPlayback.ambient.play();
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (isOurMessage && (status === 'playing' || status === 'paused')) {
      audioPlayback.toggle();
    } else if (message.verses?.length) {
      void startPlaybackForVerses(message.id, message.verses);
    }
  }, [isOurMessage, status, message.id, message.verses]);

  const cycleRate = useCallback(() => {
    const idx = RATE_CYCLE.indexOf(rate);
    const next = RATE_CYCLE[(idx + 1) % RATE_CYCLE.length] ?? 1;
    audioPlayback.setPlaybackRate(next);
    setRate(next);
  }, [rate]);

  const toggleRepeat = useCallback(() => {
    const next = !repeat;
    audioPlayback.setLoopCurrent(next);
    setRepeat(next);
  }, [repeat]);

  const handleWordTap = useCallback(
    (verseIdx: number, wordIdx: number) => {
      if (!message.verses?.length) return;
      const playbackCurrent = usePlaybackStore.getState().current;
      if (
        playbackCurrent?.messageId === message.id &&
        playbackCurrent.verseIndex === verseIdx
      ) {
        audioPlayback.seekToWord(wordIdx);
        return;
      }
      if (playbackCurrent?.messageId === message.id) {
        audioPlayback.goToVerseIndex(verseIdx, wordIdx);
        return;
      }
      void startPlaybackForVerses(message.id, message.verses, verseIdx, wordIdx);
    },
    [message.id, message.verses],
  );

  const verses = useMemo(() => message.verses ?? [], [message.verses]);
  // Group adjacent verses into runs sharing the same book + chapter so we can
  // print a single chapter heading per run.
  const runs = useMemo(() => {
    const out: { headerKey: string; bookId: number; chapter: number; translation: string; items: typeof verses }[] = [];
    for (const v of verses) {
      const last = out[out.length - 1];
      if (last && last.bookId === v.bookId && last.chapter === v.chapter) {
        last.items.push(v);
      } else {
        out.push({
          headerKey: `${v.bookId}-${v.chapter}`,
          bookId: v.bookId,
          chapter: v.chapter,
          translation: v.translation,
          items: [v],
        });
      }
    }
    return out;
  }, [verses]);

  const menuItems: MessageActionItem[] = [
    {
      key: 'copy',
      label: t('chat.actions.copy'),
      onClick: () => {
        const text = verses
          .map((v) => `${v.verse} ${v.text}`)
          .join('\n');
        if (text) void navigator.clipboard?.writeText(text);
      },
    },
    {
      key: 'share',
      label: t('chat.actions.share'),
      onClick: () => {
        const text = verses.map((v) => `${v.display}\n${v.text}`).join('\n\n');
        if (navigator.share) {
          void navigator.share({ text });
        } else if (text) {
          void navigator.clipboard?.writeText(text);
        }
      },
    },
    {
      key: 'delete',
      label: t('chat.actions.delete'),
      destructive: true,
      onClick: () => {
        const idx = useChatStore
          .getState()
          .messages.findIndex((m) => m.id === message.id);
        if (idx >= 0) {
          const next = useChatStore.getState().messages.slice();
          next.splice(idx, 1);
          useChatStore.setState({ messages: next });
        }
      },
    },
  ];

  return (
    <>
      <article
        onClick={onSelect}
        className={clsx(
          'card-paper rounded-r-2xl rounded-l-md my-1 px-4 py-3 bg-navy-soft/20',
          'border-l-2 border-gold/70 transition-all',
          selected && 'border-l-4 border-gold ring-1 ring-gold/30',
          isHighlighted && 'ring-2 ring-gold animate-pulse-soft',
        )}
      >
        {runs.map((run, ri) => {
          const book = getBookById(run.bookId);
          const lang = (i18n.language || 'en').startsWith('de') ? 'de' : 'en';
          const bookName = book ? (lang === 'de' ? book.nameDe : book.nameEn) : `Book ${run.bookId}`;
          return (
            <div key={`${run.headerKey}-${ri}`} className={ri > 0 ? 'mt-4 pt-4 border-t border-gold/15' : ''}>
              <header className="flex items-baseline justify-between mb-2">
                <h3 className="font-serif text-gold text-lg leading-tight">
                  {bookName} {run.chapter}
                </h3>
                <span className="text-[10px] uppercase tracking-wider text-gold-dim">
                  {run.translation}
                </span>
              </header>
              <div className="font-serif text-cream/95 leading-7 space-y-1">
                {run.items.map((v) => {
                  const verseIdx = verses.indexOf(v);
                  return (
                    <WordHighlighter
                      key={`${v.bookId}-${v.chapter}-${v.verse}-${verseIdx}`}
                      messageId={message.id}
                      verseIndex={verseIdx}
                      verse={v}
                      onWordTap={handleWordTap}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}

        <ReaderControls
          isPlaying={isPlaying}
          isLoading={isLoading}
          rate={rate}
          repeat={repeat}
          autoScroll={autoScroll}
          ambientVisible={ambientReady && isOurMessage}
          ambientOn={ambientOn}
          onTogglePlay={togglePlay}
          onCycleRate={cycleRate}
          onToggleRepeat={toggleRepeat}
          onToggleAutoScroll={() => setAutoScroll(!autoScroll)}
          onToggleAmbient={toggleAmbient}
          onMenu={(pos) => setMenuPos(pos)}
        />

        {cont.canContinue && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              cont.sendNext();
            }}
            disabled={isProcessing}
            className={clsx(
              'mt-3 w-full h-10 text-sm rounded-xl border border-gold/30 text-gold',
              'hover:bg-gold/10 active:scale-[0.98] transition-all',
              isProcessing && 'opacity-50 pointer-events-none',
            )}
          >
            {t('chat.reader.continue', { range: cont.nextLabel })} →
          </button>
        )}
      </article>
      {menuPos && (
        <MessageActionsMenu
          anchor={menuPos}
          items={menuItems}
          onClose={() => setMenuPos(null)}
        />
      )}
    </>
  );
}
