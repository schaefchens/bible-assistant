import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useNarrationVoice } from '@/hooks/useSpeechVoice';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { voiceKeyPart } from '@/services/voices/ttsVoice';

/**
 * The narration download buttons address audio by the voice this hook
 * returns. Key status arrives *after* boot, so a button rendered in that first
 * moment shows the fallback voice — and must follow when the status lands, or
 * it offers to download (and reports coverage for) a voice that is not the one
 * that will read.
 *
 * A render rule, so this layer: the resolver itself is pinned in
 * tests/unit/voiceProfiles.test.ts; what it cannot show is that the hook
 * re-renders on the *settings* store changing while the choice, in the
 * *library* store, stays put.
 */

const GEORGE_ID = '0b2c6f1e-3a4d-4c5e-9f60-718293a4b5c6';

function Probe() {
  const voice = useNarrationVoice();
  return <span data-voice={voice.provider === 'device' ? 'device' : voiceKeyPart(voice)}>voice</span>;
}

const shown = () => screen.getByText('voice').getAttribute('data-voice');

beforeEach(() => {
  useLibraryStore.setState({
    voices: [
      {
        v: 1,
        id: GEORGE_ID,
        name: 'George',
        config: {
          provider: 'elevenlabs',
          voiceId: 'JBFqnCBsd6RMkjVDRZzb',
          model: 'eleven_v4',
          stability: 0.5,
          similarity: 0.75,
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    voiceSelection: { narration: GEORGE_ID, assistant: 'system:device', updatedAt: 1 },
  });
  useSettingsStore.setState({ hasUserElevenLabsKey: false, elevenLabsFailure: null });
});

describe('useNarrationVoice', () => {
  it('follows key status as it lands after boot, and a failure as it happens', () => {
    render(<Probe />);
    expect(shown()).toBe('echo|');

    act(() => useSettingsStore.setState({ hasUserElevenLabsKey: true }));
    expect(shown()).toBe('el:JBFqnCBsd6RMkjVDRZzb|eleven_v4,0.50,0.75');

    act(() => useSettingsStore.setState({ elevenLabsFailure: { kind: 'quota' } }));
    expect(shown()).toBe('echo|');
  });

  it('follows a choice synced in from another device', () => {
    useSettingsStore.setState({ hasUserElevenLabsKey: true });
    render(<Probe />);
    act(() =>
      useLibraryStore.setState({
        voiceSelection: { narration: 'system:device', assistant: 'system:device', updatedAt: 2 },
      }),
    );
    expect(shown()).toBe('device');
  });
});
