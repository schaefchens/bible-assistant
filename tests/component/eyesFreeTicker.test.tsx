import { render } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { RollingTicker } from '@/components/voice/EyesFreeMode';
import { usePlaybackStore } from '@/store/playbackStore';
import { useChatStore } from '@/store/chatStore';
import type { VerseSummary } from '@/types/domain';

/**
 * The eyes-free ticker shows the four words around the one being spoken, and it
 * has to survive a *gap* — punctuation, the moment between two tracks, a
 * chapter announcement — without flickering, while still going blank when
 * playback actually stops.
 *
 * That memory used to be a ref written during render, which made the output
 * depend on how many times the component had rendered rather than on its
 * inputs. It is now a guarded state adjustment during render, and this is the
 * test that rewrite never had: the whole point is behaviour across a
 * *sequence* of renders, which no pure function can see and which a journey
 * would have to enter hands-free mode and wait on real audio to reach.
 *
 * No mocks. `useReadingVerses` reads the chat and reader stores, so the real
 * ones drive it.
 */

const GROUP = 'group-1';

const verse = (text: string): VerseSummary => ({
  translation: 'KJV',
  bookId: 19,
  chapter: 117,
  verse: 1,
  text,
  display: 'Psalm 117:1',
});

/** Ten words, so a word index maps onto a predictable chunk of four. */
const WORDS = 'one two three four five six seven eight nine ten';

function playing(over: { wordIndex?: number; isVerse?: boolean } = {}) {
  usePlaybackStore.setState({
    status: 'playing',
    current: {
      groupId: GROUP,
      verseIndex: 0,
      totalVerses: 1,
      audioUrl: 'blob:x',
      position: 0,
      duration: 10,
      currentWordIndex: over.wordIndex ?? 0,
      isVerse: over.isVerse ?? true,
    },
  });
}

/** What the ticker is showing, in order. */
const shown = () =>
  Array.from(document.querySelectorAll('span[style]')).map((n) => n.textContent);

/** The word currently marked as active, if any. */
const active = () =>
  document.querySelector('span[class*="text-brand-bright"]')?.textContent ?? null;

beforeEach(() => {
  usePlaybackStore.setState({ status: 'idle', current: null });
  useChatStore.setState({
    messages: [{ id: GROUP, role: 'assistant', text: '', createdAt: 0, verses: [verse(WORDS)] }],
  });
});

describe('the chunk the ticker shows', () => {
  it('shows nothing at all before anything plays', () => {
    render(<RollingTicker />);
    expect(shown()).toEqual([]);
  });

  it('shows the four words around the one being spoken', () => {
    playing({ wordIndex: 1 });
    render(<RollingTicker />);
    expect(shown()).toEqual(['one', 'two', 'three', 'four']);
    expect(active()).toBe('two');
  });

  it('moves to the next chunk once the word crosses the boundary', () => {
    playing({ wordIndex: 3 });
    render(<RollingTicker />);
    expect(shown()).toEqual(['one', 'two', 'three', 'four']);

    act(() => playing({ wordIndex: 4 }));
    expect(shown()).toEqual(['five', 'six', 'seven', 'eight']);
    expect(active()).toBe('five');
  });

  it('shows a short final chunk rather than padding it', () => {
    playing({ wordIndex: 8 });
    render(<RollingTicker />);
    expect(shown()).toEqual(['nine', 'ten']);
  });
});

describe('a gap keeps the last chunk — the rule the rewrite had to preserve', () => {
  it('holds the chunk through a chapter announcement', () => {
    // An announcement is `isVerse: false`, and its alignment maps onto nothing
    // rendered — so there is no chunk to show, and blanking would flicker.
    playing({ wordIndex: 4 });
    render(<RollingTicker />);
    expect(shown()).toEqual(['five', 'six', 'seven', 'eight']);

    act(() => playing({ wordIndex: 0, isVerse: false }));
    expect(shown()).toEqual(['five', 'six', 'seven', 'eight']);
  });

  it('holds the chunk through the moment between two tracks', () => {
    // Between tracks the word index is -1.
    playing({ wordIndex: 4 });
    render(<RollingTicker />);
    act(() => playing({ wordIndex: -1 }));
    expect(shown()).toEqual(['five', 'six', 'seven', 'eight']);
  });

  it('holds it across several gap renders, not just the first', () => {
    // The ref version could be recomputed and lose the memory at any point;
    // this is the sequence that makes that visible.
    playing({ wordIndex: 4 });
    render(<RollingTicker />);
    for (let i = 0; i < 3; i++) {
      act(() => playing({ wordIndex: -1, isVerse: false }));
      expect(shown()).toEqual(['five', 'six', 'seven', 'eight']);
    }
  });

  it('picks the new chunk up again when the words resume', () => {
    playing({ wordIndex: 4 });
    render(<RollingTicker />);
    act(() => playing({ wordIndex: -1 }));
    act(() => playing({ wordIndex: 0 }));
    expect(shown()).toEqual(['one', 'two', 'three', 'four']);
  });
});

describe('a stop clears it — the other half of the rule', () => {
  it('goes blank when playback stops', () => {
    playing({ wordIndex: 4 });
    render(<RollingTicker />);
    act(() => usePlaybackStore.setState({ status: 'idle', current: null }));
    expect(shown()).toEqual([]);
  });

  it('blanks the moment the status says idle, even with the track still attached', () => {
    // Not a contrived state: `audioPlaybackManager` stops with two separate
    // store writes — `setStatus('idle')` then `setCurrent(null)` — so between
    // them the status is idle while the old track is still there, with a valid
    // word index. Showing words for a reading that has stopped is the bug this
    // guards, and without this case the guard looks redundant: clearing the
    // held chunk blanks the ticker on its own in every *other* stop path.
    playing({ wordIndex: 4 });
    render(<RollingTicker />);
    act(() => usePlaybackStore.setState({ status: 'idle' }));
    expect(shown()).toEqual([]);
  });

  it('keeps the chunk while merely paused', () => {
    // Pausing must not take the words away: `status` is not 'idle' and the
    // track is still there.
    playing({ wordIndex: 4 });
    render(<RollingTicker />);
    act(() => usePlaybackStore.setState({ status: 'paused' }));
    expect(shown()).toEqual(['five', 'six', 'seven', 'eight']);
  });

  it('does not resurrect the old chunk on the next reading', () => {
    // The memory is dropped on a stop, so a fresh reading starts blank rather
    // than flashing the previous one's words.
    playing({ wordIndex: 4 });
    render(<RollingTicker />);
    act(() => usePlaybackStore.setState({ status: 'idle', current: null }));
    act(() => playing({ wordIndex: -1 }));
    expect(shown()).toEqual([]);
  });
});
