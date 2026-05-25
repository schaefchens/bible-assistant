import { useTranslation } from 'react-i18next';
import { useChatStore } from '@/store/chatStore';

const READ_TOOLS = new Set(['read_verses', 'lookup_verses', 'random_verse', 'continue_from_ribbon']);
const CARD_TOOLS = new Set([
  'create_card',
  'update_card',
  'delete_card',
  'list_cards',
  'reorder_cards',
  'create_board',
  'delete_board',
  'add_card_to_board',
  'remove_card_from_board',
  'list_boards',
]);
const SETTINGS_TOOLS = new Set([
  'set_language',
  'set_translation',
  'set_voice',
  'set_playback_rate',
  'set_music',
  'set_reader_preferences',
  'set_announcements',
  'set_mic_position',
]);

export function ThinkingIndicator() {
  const { t } = useTranslation();
  const isProcessing = useChatStore((s) => s.isProcessing);
  const currentTool = useChatStore((s) => s.currentTool);

  if (!isProcessing) return null;

  let label = t('chat.thinking');
  if (currentTool) {
    if (READ_TOOLS.has(currentTool)) label = t('chat.thinkingFetching');
    else if (CARD_TOOLS.has(currentTool)) label = t('chat.thinkingCards');
    else if (SETTINGS_TOOLS.has(currentTool)) label = t('chat.thinkingSettings');
  }

  return (
    <div className="px-4 py-2 flex items-center gap-2 text-cream-dim text-sm italic">
      <span className="inline-flex gap-1" aria-hidden>
        <Dot delay="0ms" />
        <Dot delay="160ms" />
        <Dot delay="320ms" />
      </span>
      <span>{label}</span>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="w-1.5 h-1.5 rounded-full bg-gold/70 animate-pulse-soft"
      style={{ animationDelay: delay }}
    />
  );
}
