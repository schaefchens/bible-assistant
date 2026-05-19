import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { WordHighlighter } from '@/components/playback/WordHighlighter';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { startPlaybackForVerses } from '@/lib/startPlayback';
import { usePlaybackStore } from '@/store/playbackStore';
import type { ChatMessage } from '@/types/domain';

type Props = {
  message: ChatMessage;
  selected: boolean;
  onSelect: () => void;
};

export function MessageItem({ message, selected, onSelect }: Props) {
  const { t } = useTranslation();
  const current = usePlaybackStore((s) => s.current);
  const status = usePlaybackStore((s) => s.status);
  const isOurPlayback =
    current?.messageId === message.id && (status === 'playing' || status === 'paused');

  const togglePlay = () => {
    if (isOurPlayback) {
      audioPlayback.toggle();
    } else if (message.verses?.length) {
      void startPlaybackForVerses(message.id, message.verses);
    }
  };

  const handleWordTap = (verseIdx: number, wordIdx: number) => {
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
  };

  return (
    <div
      onClick={onSelect}
      className={clsx(
        'group rounded-2xl px-4 py-3 transition-all',
        message.role === 'user'
          ? 'bg-navy-soft/60 ml-8'
          : 'bg-navy-soft/30 mr-8',
        selected && 'message-selected',
      )}
    >
      {message.text && (
        <p
          className={clsx(
            'whitespace-pre-wrap',
            message.role === 'assistant' && 'text-cream/90',
          )}
        >
          {message.text}
        </p>
      )}

      {message.verses && message.verses.length > 0 && (
        <div className="mt-3 space-y-3">
          {message.verses.map((v, i) => {
            const prev = i > 0 ? message.verses![i - 1] : null;
            const showHeading =
              !prev || prev.bookId !== v.bookId || prev.chapter !== v.chapter;
            return (
              <div key={`${v.bookId}-${v.chapter}-${v.verse}-${i}`}>
                {showHeading && (
                  <div
                    className={clsx(
                      'text-xs font-sans text-gold mb-1',
                      i > 0 && 'mt-3 pt-3 border-t border-gold/20',
                    )}
                  >
                    {v.display.split(':')[0]}
                  </div>
                )}
                <WordHighlighter
                  messageId={message.id}
                  verseIndex={i}
                  verse={v}
                  onWordTap={handleWordTap}
                />
              </div>
            );
          })}
          <div className="pt-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="btn-ghost text-xs"
            >
              {isOurPlayback && status === 'playing' ? t('playback.pause') : t('playback.play')}
            </button>
          </div>
        </div>
      )}

      {message.toolCalls && message.toolCalls.length > 0 && !message.text && !message.verses?.length && (
        <p className="text-xs text-cream-dim italic">
          {message.toolCalls.map((tc) => tc.name).join(', ')}
        </p>
      )}
    </div>
  );
}
