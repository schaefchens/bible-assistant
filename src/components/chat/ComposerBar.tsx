import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCommandPipeline } from '@/hooks/useCommandPipeline';
import { useChatStore } from '@/store/chatStore';
import { useBottomBarHeight } from '@/hooks/useBottomBarHeight';
import { audioPlayback } from '@/lib/audioPlaybackManager';

export function ComposerBar() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const isProcessing = useChatStore((s) => s.isProcessing);
  const { send } = useCommandPipeline();
  const containerRef = useRef<HTMLFormElement>(null);
  useBottomBarHeight(containerRef);

  const submit = (override?: string) => {
    const value = (override ?? text).trim();
    if (!value || isProcessing) return;
    void send(value);
    setText('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    audioPlayback.ensureContext();
    submit();
  };

  return (
    <form
      ref={containerRef}
      onSubmit={handleSubmit}
      className="relative flex items-end gap-2 p-3 pb-safe border-t border-surface-raised bg-surface"
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={t('chat.placeholder')}
        rows={1}
        className="flex-1 resize-none bg-surface-raised text-ink rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-brand/60 max-h-32"
        disabled={isProcessing}
      />
      <button
        type="submit"
        className="btn-primary shrink-0 h-12 px-5"
        disabled={isProcessing || !text.trim()}
      >
        {t('chat.send')}
      </button>
    </form>
  );
}
