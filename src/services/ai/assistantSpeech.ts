import { postTtsSpeak } from '@/services/api/tts';
import { browserTts } from '@/lib/browserTts';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { usePlaybackStore } from '@/store/playbackStore';
import {
  effectiveAssistantVoice,
  effectiveVoiceStyle,
  useSettingsStore,
} from '@/store/settingsStore';
import { isBrowserVoice } from '@/types/domain';

/** Speak the assistant's text reply aloud (when "speak assistant" is enabled),
 * routing to browser TTS or OpenAI TTS depending on the chosen assistant
 * voice. No-op for empty text or when speaking is disabled. */
export async function speakAssistantReply(text: string, messageId: string): Promise<void> {
  const trimmed = stripMarkdownForSpeech(text);
  if (!trimmed) return;
  const { speakAssistant, locale } = useSettingsStore.getState();
  if (!speakAssistant) return;
  const assistantVoice = effectiveAssistantVoice();
  // A verse is actively playing → the reply should interject (pause the
  // reading, speak, resume) rather than queue behind the whole passage.
  const readingActive = usePlaybackStore.getState().status === 'playing';

  if (isBrowserVoice(assistantVoice)) {
    const lang = locale === 'de' ? 'de-DE' : 'en-US';
    if (readingActive && !browserTts.isActive()) {
      // Reading is on the OpenAI/Web-Audio engine: pause it, speak the reply,
      // resume on end. (A browser-voice reading can't be cleanly interrupted
      // on the single SpeechSynthesis engine, so that case falls through.)
      audioPlayback.pause();
      void browserTts.speakOneShot(trimmed, lang, () => audioPlayback.resume());
    } else {
      void browserTts.enqueue([
        {
          messageId,
          verseIndex: 0,
          text: trimmed,
          translation: locale === 'de' ? 'S00' : 'ESV',
        },
      ]);
    }
    return;
  }
  const voiceStyle = effectiveVoiceStyle();
  try {
    const tts = await postTtsSpeak({
      text: trimmed,
      voice: assistantVoice,
      voiceStyle: voiceStyle || undefined,
      language: locale === 'de' ? 'de' : 'en',
    });
    audioPlayback.ensureContext();
    if (readingActive) {
      // Interject: pause the reading, play the reply over the speech bus,
      // resume after — so the answer doesn't wait behind the whole passage.
      void audioPlayback.interject(tts.audioUrl);
    } else {
      void audioPlayback.enqueue([
        {
          messageId,
          verseIndex: 0,
          audioUrl: tts.audioUrl,
          alignmentUrl: tts.alignmentUrl,
        },
      ]);
    }
  } catch (e) {
    console.warn('assistant TTS failed', e);
  }
}

// Strip the lightweight markdown the assistant may emit so the TTS engine
// doesn't read out asterisks, hashes, or link syntax.
function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .trim();
}
