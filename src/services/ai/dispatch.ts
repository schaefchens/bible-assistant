import type { ToolName, ToolArgs } from './tools';
import { parseReference } from '@/services/bible/referenceParser';
import { getVerses, getChapter, stripHtml } from '@/services/bible/bibleApi';
import type { Translation } from '@/services/bible/bibleApi';
import {
  BOOKS,
  findBookByName,
  formatRangeList,
  formatReference,
  getBookById,
} from '@/services/bible/bookCatalog';
import { useSettingsStore } from '@/store/settingsStore';
import { useChatStore } from '@/store/chatStore';
import { useLibraryStore, nowId } from '@/store/libraryStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useRibbonsStore, type RibbonColor, RIBBON_COLORS } from '@/store/ribbonsStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { browserTts } from '@/lib/browserTts';
import {
  startAmbientIfEnabled,
  planToBrowserItems,
  planToOpenAiTracks,
} from '@/lib/startPlayback';
import { buildPlaybackPlan } from '@/lib/playbackPlan';
import {
  isBrowserVoice,
  type Card,
  type Board,
  type OpenAiVoiceId,
  type VerseSummary,
} from '@/types/domain';

type DispatchContext = {
  messageId: string;
  /** Aborted when the user issued a voice/text "stop". Tools that do
   * expensive work (TTS, audio enqueue) should bail out if it's set. */
  signal?: AbortSignal;
};

export type ToolDispatchResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

export async function dispatchTool(
  name: ToolName,
  argsJson: string,
  ctx: DispatchContext,
): Promise<ToolDispatchResult> {
  let args: unknown;
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return { ok: false, error: 'invalid JSON arguments' };
  }
  try {
    switch (name) {
      case 'read_verses':
        return await handleReadVerses(args as ToolArgs['read_verses'], ctx, true);
      case 'lookup_verses':
        return await handleReadVerses(args as ToolArgs['lookup_verses'], ctx, false);
      case 'random_verse':
        return await handleRandomVerse(args as ToolArgs['random_verse'], ctx);
      case 'create_card':
        return await handleCreateCard(args as ToolArgs['create_card']);
      case 'update_card':
        return await handleUpdateCard(args as ToolArgs['update_card']);
      case 'delete_card':
        return await handleDeleteCard(args as ToolArgs['delete_card']);
      case 'list_cards':
        return { ok: true, data: listCardsInUserOrder() };
      case 'reorder_cards':
        return await handleReorderCards(args as ToolArgs['reorder_cards']);
      case 'create_board':
        return await handleCreateBoard(args as ToolArgs['create_board']);
      case 'delete_board':
        return await handleDeleteBoard(args as ToolArgs['delete_board']);
      case 'add_card_to_board':
        return await handleAddCardToBoard(args as ToolArgs['add_card_to_board']);
      case 'remove_card_from_board':
        return await handleRemoveCardFromBoard(
          args as ToolArgs['remove_card_from_board'],
        );
      case 'list_boards':
        return { ok: true, data: useLibraryStore.getState().boards };
      case 'set_language':
        useSettingsStore.getState().setLocale((args as ToolArgs['set_language']).language);
        return { ok: true };
      case 'set_translation':
        useSettingsStore
          .getState()
          .setTranslation((args as ToolArgs['set_translation']).translation, true);
        return { ok: true };
      case 'set_voice':
        useSettingsStore.getState().setVoice((args as ToolArgs['set_voice']).voice);
        return { ok: true };
      case 'save_ribbon':
        return await handleSaveRibbon(args as ToolArgs['save_ribbon']);
      case 'continue_from_ribbon':
        return await handleContinueFromRibbon(
          args as ToolArgs['continue_from_ribbon'],
          ctx,
        );
      default:
        return { ok: false, error: `unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function handleReadVerses(
  args: { reference: string; translation?: Translation },
  ctx: DispatchContext,
  autoplay: boolean,
): Promise<ToolDispatchResult> {
  const parsed = parseReference(args.reference);
  if (!parsed) return { ok: false, error: `could not parse reference "${args.reference}"` };
  const { locale, translation: defaultTrans, voice, voiceStyle } = useSettingsStore.getState();
  const translation = args.translation ?? defaultTrans;
  const verses = await getVerses(translation, parsed);
  if (verses.length === 0) return { ok: false, error: 'no verses found' };

  const summaries: VerseSummary[] = verses.map((v) => ({
    translation,
    bookId: parsed.bookId,
    chapter: parsed.chapter,
    verse: v.verse,
    text: stripHtml(v.text),
    display: formatReference(parsed.bookId, parsed.chapter, v.verse, v.verse, locale),
  }));

  // Capture how many verses the message ALREADY has so we can shift the
  // plan's verseIndex into the final message.verses index space. Without
  // this, a second read_verses call in the same turn would produce tracks
  // whose verseIndex starts at 0, while the rendered verses array has the
  // new batch at positions [existing..existing+N-1] — highlighting would
  // point at the wrong verses.
  const existingVerseCount =
    useChatStore.getState().messages.find((m) => m.id === ctx.messageId)
      ?.verses?.length ?? 0;

  useChatStore.getState().attachVerses(ctx.messageId, summaries);
  // Whole-chapter when the reference had no verse range (e.g. "Galatians 5"
  // rather than "Galatians 5:1-5"). Stored on the message so a later tap-
  // to-play preserves the same heading style.
  const wholeChapter = parsed.verseStart === undefined;
  useChatStore
    .getState()
    .updateMessage(ctx.messageId, { headingWholeChapter: wholeChapter });

  if (autoplay && !ctx.signal?.aborted) {
    audioPlayback.ensureContext();
    startAmbientIfEnabled();
    const settings = useSettingsStore.getState();
    const rawPlan = buildPlaybackPlan(summaries, {
      locale,
      readChapterHeadings: settings.readChapterHeadings,
      readVerseNumbers: settings.readVerseNumbers,
      verseNumberStyle: settings.verseNumberStyle,
      pauseBetweenVersesMs: settings.pauseBetweenVersesMs,
      pauseBetweenChaptersMs: settings.pauseBetweenChaptersMs,
      wholeChapter,
    });
    const plan =
      existingVerseCount === 0
        ? rawPlan
        : rawPlan.map((it) => ({
            ...it,
            verseIndex: it.verseIndex + existingVerseCount,
          }));
    if (isBrowserVoice(voice)) {
      if (!ctx.signal?.aborted) {
        void browserTts.enqueue(planToBrowserItems(plan, ctx.messageId));
      }
    } else {
      const tracks = await planToOpenAiTracks(
        plan,
        ctx.messageId,
        voice as OpenAiVoiceId,
        voiceStyle || undefined,
        ctx.signal,
      );
      if (tracks.length > 0 && !ctx.signal?.aborted) {
        void audioPlayback.enqueue(tracks);
      }
    }
  }

  // For the tool result we need the ACTUAL selection (including gaps),
  // not just the first..last span — otherwise non-contiguous reads like
  // "Matthew 22:37,39" would report back as "Matthew 22:37-39" and the
  // model would think verse 38 was played.
  const refString = parsed.verseRanges
    ? formatRangeList(parsed.bookId, parsed.chapter, parsed.verseRanges, locale)
    : formatReference(parsed.bookId, parsed.chapter, undefined, undefined, locale);
  return {
    ok: true,
    data: {
      reference: refString,
      count: summaries.length,
    },
  };
}

function cryptoRandomInt(n: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 0;
  const buf = new Uint32Array(1);
  // rejection sampling — drop values that would bias the modulo
  const limit = Math.floor(0xffffffff / n) * n;
  for (let i = 0; i < 16; i++) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
  // pathological fallback (should never trigger for sane n)
  crypto.getRandomValues(buf);
  return buf[0] % n;
}

async function handleRandomVerse(
  args: ToolArgs['random_verse'],
  ctx: DispatchContext,
): Promise<ToolDispatchResult> {
  const { translation: defaultTrans } = useSettingsStore.getState();
  const translation = args.translation ?? defaultTrans;

  // Resolve book scope
  let bookId: number | undefined;
  if (args.book) {
    const found = findBookByName(args.book);
    if (!found) return { ok: false, error: `unknown book "${args.book}"` };
    bookId = found.id;
  }

  // Pick a random book if not specified
  if (bookId === undefined) {
    bookId = BOOKS[cryptoRandomInt(BOOKS.length)].id;
  }
  const book = getBookById(bookId);
  if (!book) return { ok: false, error: `unknown book id ${bookId}` };

  // Resolve / pick chapter
  let chapter = args.chapter;
  if (chapter !== undefined) {
    if (chapter < 1 || chapter > book.chapters) {
      return { ok: false, error: `chapter ${chapter} out of range for ${book.nameEn}` };
    }
  } else {
    chapter = cryptoRandomInt(book.chapters) + 1;
  }

  // Fetch the chapter to learn verse count, then pick a verse
  const verses = await getChapter(translation, bookId, chapter);
  if (verses.length === 0) {
    return { ok: false, error: `no verses returned for ${book.nameEn} ${chapter}` };
  }
  const picked = verses[cryptoRandomInt(verses.length)];

  // Delegate to the standard read flow so the user hears it and sees it.
  return handleReadVerses(
    { reference: `${book.nameEn} ${chapter}:${picked.verse}`, translation },
    ctx,
    true,
  );
}

function resolveBoard(ref: string): Board | undefined {
  const boards = useLibraryStore.getState().boards;
  const byId = boards.find((b) => b.id === ref);
  if (byId) return byId;
  const lower = ref.trim().toLowerCase();
  return boards.find((b) => b.name.trim().toLowerCase() === lower);
}

type CardLookup =
  | { ok: true; card: Card }
  | { ok: false; error: string };

function resolveCard(ref: string): CardLookup {
  const cards = useLibraryStore.getState().cards;
  const byId = cards.find((c) => c.id === ref);
  if (byId) return { ok: true, card: byId };
  const lower = ref.trim().toLowerCase();
  const byTitle = cards.filter((c) => c.title.trim().toLowerCase() === lower);
  if (byTitle.length === 1) return { ok: true, card: byTitle[0] };
  if (byTitle.length === 0) return { ok: false, error: `card "${ref}" not found` };
  return {
    ok: false,
    error: `multiple cards titled "${ref}" — use card id instead (${byTitle.map((c) => c.id).join(', ')})`,
  };
}

function listCardsInUserOrder(): Card[] {
  const { cards, cardOrder } = useLibraryStore.getState();
  const rank = new Map(cardOrder.map((id, i) => [id, i]));
  const fallback = cards.length + 1;
  return cards.slice().sort((a, b) => {
    const ra = rank.get(a.id) ?? fallback;
    const rb = rank.get(b.id) ?? fallback;
    if (ra !== rb) return ra - rb;
    return b.updatedAt - a.updatedAt;
  });
}

async function handleCreateCard(args: ToolArgs['create_card']): Promise<ToolDispatchResult> {
  const requestedBoards = args.boards ?? [];
  const resolvedBoards: Board[] = [];
  for (const ref of requestedBoards) {
    const board = resolveBoard(ref);
    if (!board) return { ok: false, error: `board "${ref}" not found` };
    resolvedBoards.push(board);
  }
  const card: Card = {
    id: nowId(),
    title: args.title,
    references: args.references,
    notes: args.notes,
    color: 'yellow',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await useLibraryStore.getState().upsertCard(card);
  for (const board of resolvedBoards) {
    if (board.cardIds.includes(card.id)) continue;
    const fresh = useLibraryStore.getState().boards.find((b) => b.id === board.id) ?? board;
    await useLibraryStore
      .getState()
      .upsertBoard({ ...fresh, cardIds: [...fresh.cardIds, card.id] });
  }
  return {
    ok: true,
    data: {
      id: card.id,
      title: card.title,
      addedToBoards: resolvedBoards.map((b) => ({ id: b.id, name: b.name })),
    },
  };
}

async function handleReorderCards(
  args: ToolArgs['reorder_cards'],
): Promise<ToolDispatchResult> {
  if (!Array.isArray(args.order)) return { ok: false, error: 'order must be an array' };
  const knownIds = new Set(useLibraryStore.getState().cards.map((c) => c.id));
  const unknown = args.order.filter((id) => !knownIds.has(id));
  if (unknown.length > 0) {
    return { ok: false, error: `unknown card ids: ${unknown.join(', ')}` };
  }
  await useLibraryStore.getState().setCardOrder(args.order);
  return { ok: true, data: { order: useLibraryStore.getState().cardOrder } };
}

async function handleUpdateCard(args: ToolArgs['update_card']): Promise<ToolDispatchResult> {
  const lookup = resolveCard(args.card);
  if (!lookup.ok) return { ok: false, error: lookup.error };
  const updated: Card = {
    ...lookup.card,
    title: args.title ?? lookup.card.title,
    references: args.references ?? lookup.card.references,
    notes: args.notes ?? lookup.card.notes,
    updatedAt: Date.now(),
  };
  await useLibraryStore.getState().upsertCard(updated);
  return { ok: true, data: { id: updated.id, title: updated.title } };
}

async function handleDeleteCard(args: ToolArgs['delete_card']): Promise<ToolDispatchResult> {
  const lookup = resolveCard(args.card);
  if (!lookup.ok) return { ok: false, error: lookup.error };
  await useLibraryStore.getState().deleteCard(lookup.card.id);
  return { ok: true, data: { id: lookup.card.id, title: lookup.card.title } };
}

async function handleCreateBoard(args: ToolArgs['create_board']): Promise<ToolDispatchResult> {
  const board: Board = {
    id: nowId(),
    name: args.name,
    cardIds: args.cardIds ?? [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await useLibraryStore.getState().upsertBoard(board);
  return { ok: true, data: { id: board.id, name: board.name } };
}

async function handleDeleteBoard(args: ToolArgs['delete_board']): Promise<ToolDispatchResult> {
  await useLibraryStore.getState().deleteBoard(args.id);
  return { ok: true };
}

async function handleAddCardToBoard(
  args: ToolArgs['add_card_to_board'],
): Promise<ToolDispatchResult> {
  const board = resolveBoard(args.board);
  if (!board) return { ok: false, error: `board "${args.board}" not found` };
  const cardLookup = resolveCard(args.card);
  if (!cardLookup.ok) return { ok: false, error: cardLookup.error };
  const cardId = cardLookup.card.id;
  if (board.cardIds.includes(cardId)) {
    return { ok: true, data: { boardId: board.id, boardName: board.name, cardId, unchanged: true } };
  }
  await useLibraryStore
    .getState()
    .upsertBoard({ ...board, cardIds: [...board.cardIds, cardId] });
  return { ok: true, data: { boardId: board.id, boardName: board.name, cardId, cardTitle: cardLookup.card.title } };
}

type ResolvedPosition = {
  translation: Translation;
  bookId: number;
  chapter: number;
  verse: number;
};

function resolveLastReadVerse(): ResolvedPosition | null {
  // Prefer the live playback position; fall back to the most recent reading
  // message in chat history (in case playback ended a few seconds ago).
  const cur = usePlaybackStore.getState().current;
  const messages = useChatStore.getState().messages;
  if (cur) {
    const msg = messages.find((m) => m.id === cur.messageId);
    const v = msg?.verses?.[cur.verseIndex];
    if (v) {
      return {
        translation: v.translation,
        bookId: v.bookId,
        chapter: v.chapter,
        verse: v.verse,
      };
    }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && m.verses && m.verses.length > 0) {
      const v = m.verses[m.verses.length - 1];
      return {
        translation: v.translation,
        bookId: v.bookId,
        chapter: v.chapter,
        verse: v.verse,
      };
    }
  }
  return null;
}

async function advanceOneVerse(p: ResolvedPosition): Promise<ResolvedPosition> {
  // Advance within the current chapter if a next verse exists.
  try {
    const verses = await getChapter(p.translation, p.bookId, p.chapter);
    if (verses.length > 0) {
      const endVerse = verses[verses.length - 1].verse;
      if (p.verse < endVerse) {
        return { ...p, verse: p.verse + 1 };
      }
    }
  } catch {
    /* fall through to chapter roll-over */
  }
  // Else roll into the start of the next chapter.
  const book = getBookById(p.bookId);
  if (book && p.chapter < book.chapters) {
    return { ...p, chapter: p.chapter + 1, verse: 1 };
  }
  // End of book — keep the same verse so save still succeeds.
  return p;
}

async function handleSaveRibbon(
  args: ToolArgs['save_ribbon'],
): Promise<ToolDispatchResult> {
  const { locale, translation: defaultTrans } = useSettingsStore.getState();
  // Default to gold when no color is named — single-ribbon UX.
  const color: RibbonColor = (args.color as RibbonColor | undefined) ?? 'gold';

  let pos: ResolvedPosition;
  if (args.position?.reference) {
    const parsed = parseReference(args.position.reference);
    if (!parsed) {
      return {
        ok: false,
        error: `could not parse reference "${args.position.reference}"`,
      };
    }
    pos = {
      translation: args.position.translation ?? defaultTrans,
      bookId: parsed.bookId,
      chapter: parsed.chapter,
      verse: parsed.verseStart ?? 1,
    };
  } else {
    const lastRead = resolveLastReadVerse();
    if (!lastRead) {
      return {
        ok: false,
        error: 'no current position — start reading first or specify a passage',
      };
    }
    // A ribbon marks where the user will resume, so save the next-to-read
    // verse (one past what they just heard).
    pos = await advanceOneVerse(lastRead);
  }

  useRibbonsStore.getState().setRibbon(color, {
    translation: pos.translation,
    bookId: pos.bookId,
    chapter: pos.chapter,
    verse: pos.verse,
  });

  const reference = formatReference(
    pos.bookId,
    pos.chapter,
    pos.verse,
    pos.verse,
    locale,
  );
  return {
    ok: true,
    data: { color, reference, savedAt: Date.now() },
  };
}

async function handleContinueFromRibbon(
  args: ToolArgs['continue_from_ribbon'],
  ctx: DispatchContext,
): Promise<ToolDispatchResult> {
  const slots = useRibbonsStore.getState().slots;

  let color: RibbonColor | undefined = args.color as RibbonColor | undefined;
  if (!color) {
    // If exactly one ribbon is set, use it. Otherwise ask the model to clarify.
    const setColors = RIBBON_COLORS.filter((c) => slots[c]);
    if (setColors.length === 1) {
      color = setColors[0];
    } else if (setColors.length === 0) {
      return { ok: false, error: 'no ribbon set yet' };
    } else {
      return {
        ok: false,
        error: `multiple ribbons set (${setColors.join(', ')}) — ask the user which one`,
      };
    }
  }

  const slot = slots[color];
  if (!slot) {
    return { ok: false, error: `no ${color} ribbon set` };
  }
  const book = getBookById(slot.bookId);
  if (!book) {
    return { ok: false, error: `unknown book id ${slot.bookId}` };
  }
  // End-of-chapter verse count requires fetching.
  const verses = await getChapter(slot.translation, slot.bookId, slot.chapter);
  if (verses.length === 0) {
    return {
      ok: false,
      error: `no verses returned for ${book.nameEn} ${slot.chapter}`,
    };
  }
  const endVerse = verses[verses.length - 1].verse;
  const reference =
    slot.verse >= endVerse
      ? `${book.nameEn} ${slot.chapter}:${slot.verse}`
      : `${book.nameEn} ${slot.chapter}:${slot.verse}-${endVerse}`;
  return handleReadVerses(
    { reference, translation: slot.translation },
    ctx,
    true,
  );
}

async function handleRemoveCardFromBoard(
  args: ToolArgs['remove_card_from_board'],
): Promise<ToolDispatchResult> {
  const board = resolveBoard(args.board);
  if (!board) return { ok: false, error: `board "${args.board}" not found` };
  const cardLookup = resolveCard(args.card);
  if (!cardLookup.ok) return { ok: false, error: cardLookup.error };
  const cardId = cardLookup.card.id;
  if (!board.cardIds.includes(cardId)) {
    return { ok: true, data: { boardId: board.id, boardName: board.name, cardId, unchanged: true } };
  }
  await useLibraryStore
    .getState()
    .upsertBoard({ ...board, cardIds: board.cardIds.filter((id) => id !== cardId) });
  return { ok: true, data: { boardId: board.id, boardName: board.name, cardId, cardTitle: cardLookup.card.title } };
}
