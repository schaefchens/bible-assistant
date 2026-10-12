import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadingGroup, ReadingHost } from '@/lib/readingHosts';
import type { NextReading } from '@/lib/readingContinuation';
import type { BibleVerse, Translation } from '@/services/bible/bibleApi';
import type { ReadingList, VerseSummary } from '@/types/domain';

/**
 * A translation's licence can rule out playing on by itself and scrolling on
 * endlessly — Schlachter 2000's rules out both (`translationCatalog`'s
 * `features`). A term of the licence, so a mistake one way breaks it, and the
 * other way silences auto-play for every other translation. Both are audio, or
 * a page, that nobody can see go wrong.
 *
 * Integration: the rule reads three stores and the host registry, and the
 * wiring under test is `autoPlay`'s store subscription and the playlist a tap
 * starts. Only the network edges are faked — `getChapter`, and the narration
 * voice (the device's own, for a tap), so nothing ever asks for speech.
 */

vi.mock('@/services/bible/bibleApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/bible/bibleApi')>()),
  getChapter: vi.fn(),
}));

vi.mock('@/lib/startPlayback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/startPlayback')>()),
  readingTtsVoice: vi.fn(async () => null),
}));

const { getChapter } = await import('@/services/bible/bibleApi');
const { readingHosts } = await import('@/lib/readingHosts');
const { playOnForbiddenBy } = await import('@/lib/readingContinuation');
const { initAutoPlay, triggerContinuation } = await import('@/lib/autoPlay');
const { startReadingPlaylist } = await import('@/lib/startPlayback');
const { audioPlayback } = await import('@/lib/audioPlaybackManager');
const { browserTts } = await import('@/lib/browserTts');
const { SYSTEM_DEVICE_ID } = await import('@/services/voices/voiceProfiles');
const { usePlaybackStore } = await import('@/store/playbackStore');
const { useReaderStore } = await import('@/store/readerStore');
const { useLibraryStore } = await import('@/store/libraryStore');
const { useCommunityStore } = await import('@/store/communityStore');
const { useSettingsStore } = await import('@/store/settingsStore');
const { BIBLE_SOURCE } = await import('@/services/reading/readingSequence');

const JOHN = 43;

const verse = (chapter: number, v: number, translation: Translation): VerseSummary => ({
  translation,
  bookId: JOHN,
  chapter,
  verse: v,
  text: `verse ${v}`,
  display: `John ${chapter}:${v}`,
});

const chapter = (n: number, translation: Translation): VerseSummary[] =>
  Array.from({ length: 3 }, (_, i) => verse(n, i + 1, translation));

const group = (translation: Translation, over: Partial<ReadingGroup> = {}): ReadingGroup => ({
  id: 'test:g',
  verses: chapter(3, translation),
  wholeChapter: true,
  ...over,
});

const next = (translation: Translation, over: Partial<NextReading> = {}): NextReading => ({
  translation,
  bookId: JOHN,
  chapter: 4,
  ...over,
});

const list = (entries: ReadingList['days'][number]['entries']): ReadingList => ({
  id: 'L1',
  name: 'Plan',
  days: [{ id: 'd1', entries }],
  createdAt: 0,
  updatedAt: 0,
});

/** A paragraph of somebody's writing, as `postToUnits` makes one. */
const postUnit = (translation: Translation): VerseSummary => ({
  ...verse(0, 1, translation),
  bookId: 0,
  unit: {
    kind: 'post',
    spaceId: 'S1',
    postId: 'P1',
    index: 0,
    language: 'de',
    title: 'A morning by the river',
    author: 'Christoph',
    publishedAt: 0,
  },
});

beforeEach(() => {
  useSettingsStore.setState({ translation: 'KJV', autoPlayReading: false, readerEndlessScroll: false });
  useLibraryStore.setState({ readingLists: [] });
  useCommunityStore.setState({ mirroredLists: [] });
});

describe('playOnForbiddenBy — what may run on by itself', () => {
  it('lets a translation whose licence permits it run on', () => {
    expect(playOnForbiddenBy(group('KJV'), next('KJV'))).toBeUndefined();
    expect(playOnForbiddenBy(group('LUT'), group('LUT', { id: 'test:h' }))).toBeUndefined();
  });

  it('never runs on out of Schlachter 2000, nor into it', () => {
    expect(playOnForbiddenBy(group('S00'), next('KJV'))?.code).toBe('S00');
    expect(playOnForbiddenBy(group('KJV'), next('S00'))?.code).toBe('S00');
    expect(playOnForbiddenBy(group('KJV'), group('S00', { id: 'test:h' }))?.code).toBe('S00');
  });

  /** What the auto-play control shows, so playback must agree with it. */
  it('runs nothing on while Schlachter 2000 is the selected translation', () => {
    useSettingsStore.setState({ translation: 'S00' });
    expect(playOnForbiddenBy(group('KJV'), next('KJV'))?.code).toBe('S00');
  });

  /**
   * The reader's controls take a list whole (`readerTextsFrom`), so a plan
   * that pins one entry to Schlachter 2000 shows auto-play as off throughout —
   * and must not then run on between two of its other entries.
   */
  it('takes a list whole: one entry pinned to Schlachter 2000 rules out the rest', () => {
    useLibraryStore.setState({
      readingLists: [list([
        { id: 'e1', bookId: JOHN, chapter: 3 },
        { id: 'e2', bookId: JOHN, chapter: 4 },
        { id: 'e3', bookId: JOHN, chapter: 5, translation: 'S00' },
      ])],
    });
    const inPlan = group('KJV', { provenance: { listId: 'L1', entryId: 'e1' } });
    expect(
      playOnForbiddenBy(inPlan, next('KJV', { provenance: { listId: 'L1', entryId: 'e2' } }))?.code,
    ).toBe('S00');
  });

  it('lets a list run on when nothing in it is pinned to a restricted text', () => {
    useLibraryStore.setState({
      readingLists: [list([
        { id: 'e1', bookId: JOHN, chapter: 3 },
        { id: 'e2', bookId: JOHN, chapter: 4, translation: 'LUT' },
      ])],
    });
    const inPlan = group('KJV', { provenance: { listId: 'L1', entryId: 'e1' } });
    expect(
      playOnForbiddenBy(inPlan, next('LUT', { provenance: { listId: 'L1', entryId: 'e2' } })),
    ).toBeUndefined();
  });

  /**
   * A post is not scripture — its `translation` is a stand-in for its voice —
   * so a shelf plays on whichever Bible is selected, as the reader's controls
   * say it does (`readerTextsFrom` names nothing for a shelf).
   */
  it('asks nothing of a post, not even the selected translation', () => {
    useSettingsStore.setState({ translation: 'S00' });
    const post = group('KJV', { verses: [postUnit('S00')], wholeChapter: false });
    const nextPost = next('S00', { bookId: 0, chapter: 0, post: { spaceId: 'S1', postId: 'P2' } });
    expect(playOnForbiddenBy(post, nextPost)).toBeUndefined();
  });
});

/**
 * The wiring: auto-play reaching the end of a reading asks the rule; the next
 * button is the user asking for the passage, and does not. Driven through the
 * playback store exactly as the engine drives it — a soft end is `playing` →
 * `idle` with the engine's soft-end flag up.
 */
describe('auto-play asks; the next button does not', () => {
  const appendReading = vi.fn<ReadingHost['appendReading']>(async () => null);
  const groups = new Map<string, ReadingGroup>();

  const softEnd = async (groupId: string) => {
    vi.spyOn(audioPlayback, 'isSoftEnded').mockReturnValue(true);
    usePlaybackStore.setState({
      status: 'playing',
      current: {
        groupId,
        verseIndex: 2,
        totalVerses: 3,
        audioUrl: 'v3.mp3',
        position: 0,
        duration: 1,
        currentWordIndex: 0,
        isVerse: true,
      },
    });
    usePlaybackStore.setState({ status: 'idle', current: null });
  };

  /** Everything the continuation does is promise-chained off resolved fakes. */
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeAll(() => {
    initAutoPlay();
  });

  beforeEach(() => {
    appendReading.mockClear();
    groups.clear();
    readingHosts.register({
      ns: 'test',
      getGroup: (id) => groups.get(id) ?? null,
      listGroups: () => [...groups.values()],
      defaultGroup: () => null,
      previousGroup: async () => null,
      appendReading,
    });
    vi.mocked(getChapter).mockImplementation(async () =>
      Array.from({ length: 3 }, (_, i) => ({ verse: i + 1, text: `v${i + 1}` })) as BibleVerse[],
    );
    usePlaybackStore.setState({ status: 'idle', current: null });
    useSettingsStore.setState({ autoPlayReading: true });
  });

  it('continues a reading by itself when its licence permits it', async () => {
    groups.set('test:g', group('KJV'));
    await softEnd('test:g');
    await vi.waitFor(() => expect(appendReading).toHaveBeenCalledOnce());
    expect(appendReading.mock.calls[0][0][0]).toMatchObject({ translation: 'KJV', chapter: 4 });
  });

  it('does not continue Schlachter 2000 by itself', async () => {
    groups.set('test:g', group('S00'));
    await softEnd('test:g');
    await flush();
    await flush();
    expect(appendReading).not.toHaveBeenCalled();
  });

  it('still lets the next button continue Schlachter 2000', async () => {
    groups.set('test:g', group('S00'));
    await triggerContinuation('test:g');
    expect(appendReading).toHaveBeenCalledOnce();
    expect(appendReading.mock.calls[0][0][0]).toMatchObject({ translation: 'S00', chapter: 4 });
  });
});

/**
 * A tap plays the reading it was on, then every reading after it in the same
 * host (`startReadingPlaylist`). Past the tapped one is continuous play, so it
 * stops where a licence rules that out; the tapped reading itself is the user
 * asking, and always plays.
 */
describe('a tap plays on past its reading only where the licence permits it', () => {
  const groups = new Map<string, ReadingGroup>();
  const queuedBehind = () =>
    vi.mocked(browserTts.enqueue).mock.calls.map(([items]) => items[0].groupId);

  /** One reading per translation, in order, and a tap on the first. */
  const tapFirstOf = async (...translations: Translation[]) => {
    translations.forEach((t, i) =>
      groups.set(`tap:${i}`, group(t, { id: `tap:${i}`, verses: chapter(3 + i, t) })),
    );
    await startReadingPlaylist('tap:0', groups.get('tap:0')!.verses);
  };

  beforeEach(() => {
    groups.clear();
    readingHosts.register({
      ns: 'tap',
      getGroup: (id) => groups.get(id) ?? null,
      listGroups: () => [...groups.values()],
      defaultGroup: () => null,
      previousGroup: async () => null,
      appendReading: async () => null,
    });
    useLibraryStore.setState({
      voiceSelection: { narration: SYSTEM_DEVICE_ID, assistant: SYSTEM_DEVICE_ID, updatedAt: 1 },
    });
    // jsdom has no AudioContext to unlock.
    vi.spyOn(audioPlayback, 'ensureContext').mockReturnValue({} as AudioContext);
    vi.spyOn(browserTts, 'speakQueue').mockResolvedValue();
    vi.spyOn(browserTts, 'enqueue').mockResolvedValue();
  });

  afterEach(() => {
    vi.mocked(audioPlayback.ensureContext).mockRestore();
    vi.mocked(browserTts.speakQueue).mockRestore();
    vi.mocked(browserTts.enqueue).mockRestore();
  });

  it('plays on through the readings after it when every licence permits it', async () => {
    await tapFirstOf('KJV', 'KJV', 'LUT');
    expect(browserTts.speakQueue).toHaveBeenCalledOnce();
    expect(queuedBehind()).toEqual(['tap:1', 'tap:2']);
  });

  it('plays a tapped Schlachter 2000 reading, and nothing after it', async () => {
    await tapFirstOf('S00', 'KJV');
    expect(vi.mocked(browserTts.speakQueue).mock.calls[0][0][0].groupId).toBe('tap:0');
    expect(queuedBehind()).toEqual([]);
  });

  it('stops before a Schlachter 2000 reading it would play on into', async () => {
    await tapFirstOf('KJV', 'KJV', 'S00', 'KJV');
    expect(queuedBehind()).toEqual(['tap:1']);
  });
});

/**
 * Auto-continuation lands in the reader through `adopt`, which decides between
 * appending (endless scroll) and turning the page. Asking the setting alone
 * stacked every continued chapter under the last, whatever the text.
 */
describe('the reader turns the page where endless scroll is ruled out', () => {
  const adoptTwo = (translation: Translation) => {
    useReaderStore.getState().adopt(chapter(3, translation));
    useReaderStore.getState().adopt(chapter(4, translation));
    return useReaderStore.getState().visible;
  };

  beforeEach(() => {
    useReaderStore.setState({ source: BIBLE_SOURCE, position: null, segments: {}, visible: [] });
    useSettingsStore.setState({ readerEndlessScroll: true });
  });

  it('appends under the chapter before when the licence permits it', () => {
    expect(adoptTwo('KJV')).toEqual(['reader:KJV:43:3', 'reader:KJV:43:4']);
  });

  it('turns the page for Schlachter 2000, whatever the setting says', () => {
    useSettingsStore.setState({ translation: 'S00' });
    expect(adoptTwo('S00')).toEqual(['reader:S00:43:4']);
    expect(useSettingsStore.getState().readerEndlessScroll).toBe(true);
  });
});
