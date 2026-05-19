import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCommandPipeline } from '@/hooks/useCommandPipeline';
import { useChatStore } from '@/store/chatStore';
import { usePushToTalk } from '@/hooks/usePushToTalk';
import { VoiceCaptureButton } from './VoiceCaptureButton';
import { audioPlayback } from '@/lib/audioPlaybackManager';

export function ComposerBar() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const isProcessing = useChatStore((s) => s.isProcessing);
  const { send } = useCommandPipeline();

  const submit = (override?: string) => {
    const value = (override ?? text).trim();
    if (!value || isProcessing) return;
    void send(value);
    setText('');
  };

  const { recording: pttRecording, hotkey: pttKey } = usePushToTalk((spoken) => submit(spoken));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    audioPlayback.ensureContext();
    submit();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="relative flex items-end gap-2 p-3 pb-safe border-t border-navy-soft bg-navy"
    >
      {pttRecording && (
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 text-xs text-gold bg-navy-deep px-2 py-1 rounded-full shadow flex items-center gap-1.5 animate-pulse-soft">
          <span className="inline-block w-2 h-2 rounded-full bg-gold" />
          {t('chat.pushToTalk')}
        </div>
      )}
      <VoiceCaptureButton
        onTranscript={(t) => submit(t)}
        pushToTalkHotkey={pttKey}
      />
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
        className="flex-1 resize-none bg-navy-soft text-cream rounded-2xl px-4 py-3 outline-none focus:ring-2 focus:ring-gold/60 max-h-32"
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
