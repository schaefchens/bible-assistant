import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useChatStore } from '@/store/chatStore';

type Chip = {
  id: string;
  labelKey: string;
  prompt: string;
  resolve?: (messages: ReturnType<typeof useChatStore.getState>['messages']) => string | null;
};

const DEFAULT_CHIPS: Chip[] = [
  { id: 'random', labelKey: 'chat.suggestions.random', prompt: 'Give me a random verse' },
  {
    id: 'lastRead',
    labelKey: 'chat.suggestions.lastRead',
    prompt: 'Read Genesis 1',
    resolve: (messages) => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role === 'assistant' && m.verses && m.verses.length > 0) {
          const last = m.verses[m.verses.length - 1];
          return `Continue reading from ${last.display}`;
        }
      }
      return null;
    },
  },
  { id: 'genesis1', labelKey: 'chat.suggestions.genesis1', prompt: 'Read Genesis 1' },
  { id: 'psalm23', labelKey: 'chat.suggestions.psalm23', prompt: 'Read Psalm 23' },
];

type Props = {
  onPick: (prompt: string) => void;
  hidden?: boolean;
};

export function SuggestionChips({ onPick, hidden }: Props) {
  const { t } = useTranslation();
  const messageCount = useChatStore((s) => s.messages.length);
  const isProcessing = useChatStore((s) => s.isProcessing);

  if (hidden) return null;
  // Show full chip rail while empty; condensed (just first two) once chat has activity.
  const visibleChips = messageCount === 0 ? DEFAULT_CHIPS : DEFAULT_CHIPS.slice(0, 2);

  return (
    <div
      className={clsx(
        'flex gap-2 overflow-x-auto no-scrollbar px-3 py-2',
        'border-b border-surface-raised/40 bg-surface/60',
      )}
    >
      {visibleChips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          disabled={isProcessing}
          onClick={() => {
            const resolved =
              chip.resolve?.(useChatStore.getState().messages) ?? chip.prompt;
            onPick(resolved);
          }}
          className={clsx(
            'shrink-0 rounded-full border border-brand/30 px-3 py-1.5 text-xs',
            'text-brand hover:bg-brand/10 active:scale-95 transition-all',
            'disabled:opacity-40 disabled:pointer-events-none',
          )}
        >
          {t(chip.labelKey)}
        </button>
      ))}
    </div>
  );
}
