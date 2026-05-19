import { MessageList } from '@/components/chat/MessageList';
import { ComposerBar } from '@/components/chat/ComposerBar';

export function ChatPage() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <MessageList />
      <ComposerBar />
    </div>
  );
}
