import { describe, expect, it } from 'vitest';
import {
  ECHO_VOICE,
  MAX_STYLE_BYTES,
  OPENAI_VOICES,
  clampStyle,
  normalizeTtsVoice,
  styleBytes,
  sameTtsVoice,
  ttsConcurrency,
  ttsSpeakBody,
  ttsVerseBody,
  voiceKeyPart,
  type TtsVoice,
} from '@/services/voices/ttsVoice';

/**
 * A voice's identity is a cache key and its request body is a wire format —
 * both "always a unit snapshot" in testing.md, because a mistake in either is
 * invisible and costs money: orphaned downloads, and every e2e run billing
 * OpenAI because the Echo request stopped matching the warm server cache.
 *
 * So the strings are pinned exactly. A property test cannot see a changed
 * separator: both sides would change together.
 */

const ELEVEN_ID = 'JBFqnCBsd6RMkjVDRZzb';

describe('the OpenAI identity is exactly what it always was', () => {
  it('Echo is `echo|` — the segment every existing key carries', () => {
    expect(voiceKeyPart(ECHO_VOICE)).toBe('echo|');
  });

  it('caps a style the way api.php counts it — UTF-8 bytes, never mid-character', () => {
    // 600 umlauts are 600 characters and 1,200 bytes: a character cap would
    // let the server refuse the voice, and a refused synced row is lost.
    const long = 'ä'.repeat(600);
    const clamped = clampStyle(long);
    expect(styleBytes(clamped)).toBeLessThanOrEqual(MAX_STYLE_BYTES);
    expect(clamped).toBe('ä'.repeat(500));
    expect(clampStyle('a'.repeat(999) + 'ä')).toBe('a'.repeat(999));
    expect(clampStyle('calm')).toBe('calm');
  });

  it('a styled voice keeps its style byte for byte, untrimmed', () => {
    const v: TtsVoice = { provider: 'openai', voice: 'nova', style: ' calm, reverent ' };
    expect(voiceKeyPart(v)).toBe('nova| calm, reverent ');
    expect(normalizeTtsVoice(v)).toEqual(v);
  });
});

describe('the ElevenLabs identity holds exactly the model’s audible fields', () => {
  it('v4: stability and similarity only — a left-over style or speed never enters it', () => {
    const v4 = normalizeTtsVoice({
      provider: 'elevenlabs',
      voiceId: ELEVEN_ID,
      model: 'eleven_v4',
      stability: 0.5,
      similarity: 0.75,
      style: 0.4,
      speed: 1.1,
    });
    expect(v4).toEqual({
      provider: 'elevenlabs',
      voiceId: ELEVEN_ID,
      model: 'eleven_v4',
      stability: 0.5,
      similarity: 0.75,
    });
    expect(voiceKeyPart(v4!)).toBe(`el:${ELEVEN_ID}|eleven_v4,0.50,0.75`);
  });

  it('Multilingual v2 adds style and speed', () => {
    const v2 = normalizeTtsVoice({
      provider: 'elevenlabs',
      voiceId: ELEVEN_ID,
      model: 'eleven_multilingual_v2',
      stability: 0.35,
      similarity: 0.8,
      style: 0.1,
      speed: 1.05,
    });
    expect(voiceKeyPart(v2!)).toBe(`el:${ELEVEN_ID}|eleven_multilingual_v2,0.35,0.80,0.10,1.05`);
  });

  it.each([
    ['float noise', 0.30000000000000004, 0.3],
    ['between steps', 0.51, 0.5],
    ['above range', 7, 1],
    ['below range', -1, 0],
    ['not a number', Number.NaN, 0.5],
  ])('quantizes onto the 0.05 grid: %s', (_, input, expected) => {
    const v = normalizeTtsVoice({
      provider: 'elevenlabs',
      voiceId: ELEVEN_ID,
      model: 'eleven_v4',
      stability: input,
      similarity: 0.75,
    });
    expect(v && v.provider === 'elevenlabs' && v.stability).toBe(expected);
  });

  it('clamps speed to ElevenLabs’ 0.7–1.2', () => {
    const at = (speed: number) =>
      voiceKeyPart(
        normalizeTtsVoice({
          provider: 'elevenlabs',
          voiceId: ELEVEN_ID,
          model: 'eleven_multilingual_v2',
          speed,
        })!,
      );
    expect(at(1.5)).toMatch(/,1\.20$/);
    expect(at(0.5)).toMatch(/,0\.70$/);
  });

  it('refuses what is not a voice', () => {
    expect(normalizeTtsVoice({ provider: 'openai', voice: 'gandalf', style: '' })).toBeNull();
    expect(normalizeTtsVoice({ provider: 'elevenlabs', voiceId: '../x', model: 'eleven_v4' })).toBeNull();
    expect(
      normalizeTtsVoice({ provider: 'elevenlabs', voiceId: ELEVEN_ID, model: 'eleven_v9' }),
    ).toBeNull();
    expect(normalizeTtsVoice({ provider: 'azure' })).toBeNull();
  });

  it('can never collide with an OpenAI voice', () => {
    const openAi = new Set(
      OPENAI_VOICES.map((voice) => voiceKeyPart({ provider: 'openai', voice, style: '' })),
    );
    const el = voiceKeyPart({
      provider: 'elevenlabs',
      voiceId: ELEVEN_ID,
      model: 'eleven_v4',
      stability: 0.5,
      similarity: 0.75,
    });
    expect(openAi.has(el)).toBe(false);
    expect(el.startsWith('el:')).toBe(true);
    expect(OPENAI_VOICES.some((v) => v.includes(':'))).toBe(false);
  });

  it('two configs that sound the same are the same voice', () => {
    const a = normalizeTtsVoice({
      provider: 'elevenlabs',
      voiceId: ELEVEN_ID,
      model: 'eleven_v4',
      stability: 0.51,
      similarity: 0.75,
    })!;
    const b = normalizeTtsVoice({
      provider: 'elevenlabs',
      voiceId: ELEVEN_ID,
      model: 'eleven_v4',
      stability: 0.5,
      similarity: 0.75,
    })!;
    expect(sameTtsVoice(a, b)).toBe(true);
  });
});

describe('request bodies', () => {
  const psalm = {
    text: 'O praise the LORD, all ye nations: praise him, all ye people.',
    translation: 'KJV',
    bookId: 19,
    chapter: 117,
    verse: 1,
  };

  it('the Echo verse body is byte-identical to what the warm server cache answers', () => {
    expect(JSON.stringify(ttsVerseBody(ECHO_VOICE, psalm))).toBe(
      '{"text":"O praise the LORD, all ye nations: praise him, all ye people.","voice":"echo","translation":"KJV","bookId":19,"chapter":117,"verse":1}',
    );
  });

  it('a style rides in third place; the Echo speak body carries no style', () => {
    expect(
      JSON.stringify(ttsVerseBody({ provider: 'openai', voice: 'nova', style: 'calm, reverent' }, psalm)),
    ).toBe(
      '{"text":"O praise the LORD, all ye nations: praise him, all ye people.","voice":"nova","voiceStyle":"calm, reverent","translation":"KJV","bookId":19,"chapter":117,"verse":1}',
    );
    expect(JSON.stringify(ttsSpeakBody(ECHO_VOICE, { text: 'Psalm 117', language: 'en' }))).toBe(
      '{"text":"Psalm 117","voice":"echo","language":"en"}',
    );
  });

  it('an ElevenLabs body names its provider and the voice twice — the server contract', () => {
    const v4: TtsVoice = {
      provider: 'elevenlabs',
      voiceId: ELEVEN_ID,
      model: 'eleven_v4',
      stability: 0.5,
      similarity: 0.75,
    };
    expect(JSON.stringify(ttsSpeakBody(v4, { text: 'Psalm 117', language: 'de' }))).toBe(
      `{"text":"Psalm 117","provider":"elevenlabs","voice":"${ELEVEN_ID}","elevenlabs":{"voiceId":"${ELEVEN_ID}","model":"eleven_v4","stability":0.5,"similarity":0.75},"language":"de"}`,
    );
  });

  it('builds ElevenLabs narration two at a time, OpenAI four', () => {
    expect(ttsConcurrency(ECHO_VOICE)).toBe(4);
    expect(
      ttsConcurrency({ provider: 'elevenlabs', voiceId: ELEVEN_ID, model: 'eleven_v4', stability: 0.5, similarity: 0.75 }),
    ).toBe(2);
  });
});
