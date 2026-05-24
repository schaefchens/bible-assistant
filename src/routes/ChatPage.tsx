import { useRef } from 'react';
import { useCommandPipeline } from '@/hooks/useCommandPipeline';
import { MessageList } from '@/components/chat/MessageList';
import { ComposerBar } from '@/components/chat/ComposerBar';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { SuggestionChips } from '@/components/chat/SuggestionChips';
import { RibbonBar } from '@/components/chat/RibbonBar';
import { ScrollToBottomFab } from '@/components/chat/ScrollToBottomFab';
import { AutoScrollFab } from '@/components/chat/AutoScrollFab';
import { audioPlayback } from '@/lib/audioPlaybackManager';

export function ChatPage() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { send } = useCommandPipeline();

  return (
    <div className="flex flex-col h-full min-h-0">
      <ChatHeader />
      <RibbonBar />
      <SuggestionChips
        onPick={(prompt) => {
          audioPlayback.ensureContext();
          void send(prompt);
        }}
      />
      <div className="relative flex-1 min-h-0 flex flex-col">
        <MessageList scrollRef={scrollRef} />
        <AutoScrollFab />
        <ScrollToBottomFab scrollRef={scrollRef} />
      </div>
      <ComposerBar />
    </div>
  );
}
