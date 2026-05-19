import type { ToolName, ToolArgs } from './tools';
import { parseReference } from '@/services/bible/referenceParser';
import { getVerses, stripHtml } from '@/services/bible/bibleApi';
import type { Translation } from '@/services/bible/bibleApi';
import { formatReference } from '@/services/bible/bookCatalog';
import { postTts } from '@/services/api/tts';
import { useSettingsStore } from '@/store/settingsStore';
import { useChatStore } from '@/store/chatStore';
import { useLibraryStore, nowId } from '@/store/libraryStore';
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
      case 'create_card':
        return await handleCreateCard(args as ToolArgs['create_card']);
      case 'update_card':
        return await handleUpdateCard(args as ToolArgs['update_card']);
      case 'delete_card':
        return await handleDeleteCard(args as ToolArgs['delete_card']);
      case 'list_cards':
        return { ok: true, data: useLibraryStore.getState().cards };
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
      void audioPlayback.playQueue(tracks);
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

async function handleCreateCard(args: ToolArgs['create_card']): Promise<ToolDispatchResult> {
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
  if (args.boardIds?.length) {
    for (const boardId of args.boardIds) {
      const board = useLibraryStore.getState().boards.find((b) => b.id === boardId);
      if (board && !board.cardIds.includes(card.id)) {
        await useLibraryStore
          .getState()
          .upsertBoard({ ...board, cardIds: [...board.cardIds, card.id] });
      }
    }
  }
  return { ok: true, data: { id: card.id, title: card.title } };
}

async function handleUpdateCard(args: ToolArgs['update_card']): Promise<ToolDispatchResult> {
  const existing = useLibraryStore.getState().cards.find((c) => c.id === args.id);
  if (!existing) return { ok: false, error: `card ${args.id} not found` };
  const updated: Card = {
    ...existing,
    title: args.title ?? existing.title,
    references: args.references ?? existing.references,
    notes: args.notes ?? existing.notes,
    updatedAt: Date.now(),
  };
  await useLibraryStore.getState().upsertCard(updated);
  return { ok: true, data: { id: updated.id } };
}

async function handleDeleteCard(args: ToolArgs['delete_card']): Promise<ToolDispatchResult> {
  await useLibraryStore.getState().deleteCard(args.id);
  return { ok: true };
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
  const board = useLibraryStore.getState().boards.find((b) => b.id === args.boardId);
  if (!board) return { ok: false, error: `board ${args.boardId} not found` };
  if (board.cardIds.includes(args.cardId)) return { ok: true, data: { unchanged: true } };
  await useLibraryStore
    .getState()
    .upsertBoard({ ...board, cardIds: [...board.cardIds, args.cardId] });
  return { ok: true };
}

async function handleRemoveCardFromBoard(
  args: ToolArgs['remove_card_from_board'],
): Promise<ToolDispatchResult> {
  const board = useLibraryStore.getState().boards.find((b) => b.id === args.boardId);
  if (!board) return { ok: false, error: `board ${args.boardId} not found` };
  await useLibraryStore
    .getState()
    .upsertBoard({ ...board, cardIds: board.cardIds.filter((id) => id !== args.cardId) });
  return { ok: true };
}
