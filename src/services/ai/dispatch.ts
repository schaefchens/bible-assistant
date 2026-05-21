import type { ToolName, ToolArgs } from './tools';
import { parseReference } from '@/services/bible/referenceParser';
import { getVerses, getChapter, stripHtml } from '@/services/bible/bibleApi';
import type { Translation } from '@/services/bible/bibleApi';
import { BOOKS, findBookByName, formatReference, getBookById } from '@/services/bible/bookCatalog';
import { postTts } from '@/services/api/tts';
import { useSettingsStore } from '@/store/settingsStore';
import { useChatStore } from '@/store/chatStore';
import { useLibraryStore, nowId } from '@/store/libraryStore';
import { usePlaybackStore } from '@/store/playbackStore';
import { useRibbonsStore, type RibbonColor } from '@/store/ribbonsStore';
import { audioPlayback, type PlaybackTrack } from '@/lib/audioPlaybackManager';
import type { Card, Board, VerseSummary } from '@/types/domain';

type DispatchContext = {
  messageId: string;
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

  useChatStore.getState().attachVerses(ctx.messageId, summaries);

  if (autoplay) {
    const tracks: PlaybackTrack[] = [];
    for (let i = 0; i < summaries.length; i++) {
      const s = summaries[i];
      try {
        const tts = await postTts({
          text: s.text,
          voice,
          voiceStyle: voiceStyle || undefined,
          translation,
          bookId: s.bookId,
          chapter: s.chapter,
          verse: s.verse,
        });
        tracks.push({
          messageId: ctx.messageId,
          verseIndex: i,
          audioUrl: tts.audioUrl,
          alignmentUrl: tts.alignmentUrl,
        });
      } catch (e) {
        console.warn('TTS failed for verse', s.display, e);
      }
    }
    if (tracks.length > 0) {
      audioPlayback.ensureContext();
      void audioPlayback.enqueue(tracks);
    }
  }

  return {
    ok: true,
    data: {
      reference: formatReference(parsed.bookId, parsed.chapter, parsed.verseStart, parsed.verseEnd, locale),
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

function resolveCurrentPosition(): ResolvedPosition | null {
  const cur = usePlaybackStore.getState().current;
  if (!cur) return null;
  const messages = useChatStore.getState().messages;
  const msg = messages.find((m) => m.id === cur.messageId);
  if (!msg?.verses) return null;
  const v = msg.verses[cur.verseIndex];
  if (!v) return null;
  return {
    translation: v.translation,
    bookId: v.bookId,
    chapter: v.chapter,
    verse: v.verse,
  };
}

async function handleSaveRibbon(
  args: ToolArgs['save_ribbon'],
): Promise<ToolDispatchResult> {
  const { locale, translation: defaultTrans } = useSettingsStore.getState();

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
    const current = resolveCurrentPosition();
    if (!current) {
      return {
        ok: false,
        error: 'no current position — start reading first or specify a passage',
      };
    }
    pos = current;
  }

  useRibbonsStore.getState().setRibbon(args.color as RibbonColor, {
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
    data: { color: args.color, reference, savedAt: Date.now() },
  };
}

async function handleContinueFromRibbon(
  args: ToolArgs['continue_from_ribbon'],
  ctx: DispatchContext,
): Promise<ToolDispatchResult> {
  const slot = useRibbonsStore.getState().slots[args.color as RibbonColor];
  if (!slot) {
    return { ok: false, error: `no ${args.color} ribbon set` };
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
