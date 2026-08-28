import type { ToolName, ToolArgs } from './tools';
import { parseReference } from '@/services/bible/referenceParser';
import { getVerses, getChapter } from '@/services/bible/bibleApi';
import { toVerseSummaries } from '@/services/bible/verseSummaries';
import { effectiveReadingVoice, effectiveVoiceStyle } from '@/store/settingsStore';
import type { Translation } from '@/services/bible/bibleApi';
import {
  findBookByName,
  formatRangeList,
  formatReference,
  getBookById,
} from '@/services/bible/bookCatalog';
import { parseCardReferenceLine } from '@/services/bible/cardReference';
import { useSettingsStore } from '@/store/settingsStore';
import { useChatStore } from '@/store/chatStore';
import { useLibraryStore, nowId } from '@/store/libraryStore';
import { useRibbonsStore, type RibbonColor, RIBBON_COLORS } from '@/store/ribbonsStore';
import { useGlobalVoiceStore } from '@/store/globalVoiceStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';
import { browserTts } from '@/lib/browserTts';
import {
  startAmbientIfEnabled,
  planToBrowserItems,
  readingUsesBrowserVoice,
  streamReading,
} from '@/lib/startPlayback';
import { getAmbientTracks } from '@/services/api/ambient';
import { buildPlaybackPlan } from '@/lib/playbackPlan';
import { cryptoRandomInt } from '@/lib/cryptoRandom';
import {
  pickRandomBook,
  pickUniformChapter,
  pickWeightedChapter,
} from '@/services/bible/randomPassage';
import { isChapterMissing } from '@/services/bible/chapterSources';
import { clamp01 } from '@/lib/math';
import {
  advanceOneVerse,
  resolveLastReadVerse,
  type ResolvedPosition,
} from '@/services/bible/playbackPosition';
import { playReadingListInChat } from '@/lib/readingListPlayback';
import { buildPlanDays } from '@/services/reading/readingPlan';
import {
  expandEntryToChapters,
  formatReadingEntry,
  listEntries,
  newReadingDay,
  newReadingList,
  parseReadingEntryLine,
} from '@/services/reading/readingEntries';
import {
  withDayAdded,
  withEntriesAdded,
  withEntryRemoved,
} from '@/lib/readingListOperations';
import {
  describeReadingList,
  listCardsInUserOrder,
  resolveBoard,
  resolveCard,
  resolveReadingList,
} from '@/services/library/cardResolver';
import { withoutCardInBoard } from '@/lib/boardOperations';
import { autoPlaceCard, clamp } from '@/lib/freeformLayout';
import {
  TEXT_SCALE_MIN,
  TEXT_SCALE_MAX,
  type Card,
  type Board,
  type FreeformCardLayout,
  type OpenAiVoiceId,
  type ReadingDay,
  type ReadingEntry,
  type ReadingList,
  type VerseSummary,
} from '@/types/domain';

/** Clamp an AI-supplied text scale to the card's allowed range. */
function clampTextScale(v: number): number {
  return clamp(v, TEXT_SCALE_MIN, TEXT_SCALE_MAX);
}

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

/** A handler for tool `N`, receiving that tool's typed args and the dispatch
 * context. May be sync or async. */
type ToolHandler<N extends ToolName> = (
  args: ToolArgs[N],
  ctx: DispatchContext,
) => ToolDispatchResult | Promise<ToolDispatchResult>;

/**
 * The single routing table from tool name to handler. The mapped type forces
 * every {@link ToolName} to have exactly one handler — a missing or misspelled
 * key is a compile error — and types each handler's `args` to that tool's
 * schema, replacing the per-case `as` casts the old switch needed.
 *
 * To add a tool: declare it in tools.ts (ToolName + ToolArgs +
 * TOOL_DEFINITIONS), then add one entry here. Nothing else to touch.
 */
const TOOL_REGISTRY: { [N in ToolName]: ToolHandler<N> } = {
  read_verses: (args, ctx) => handleReadVerses(args, ctx, true),
  lookup_verses: (args, ctx) => handleReadVerses(args, ctx, false),
  random_passage: (args, ctx) => handleRandomPassage(args, ctx),
  create_card: (args) => handleCreateCard(args),
  update_card: (args) => handleUpdateCard(args),
  delete_card: (args) => handleDeleteCard(args),
  list_cards: () => ({ ok: true, data: listCardsInUserOrder() }),
  reorder_cards: (args) => handleReorderCards(args),
  create_board: (args) => handleCreateBoard(args),
  delete_board: (args) => handleDeleteBoard(args),
  add_card_to_board: (args) => handleAddCardToBoard(args),
  remove_card_from_board: (args) => handleRemoveCardFromBoard(args),
  arrange_card: (args) => handleArrangeCard(args),
  list_boards: () => ({ ok: true, data: useLibraryStore.getState().boards }),
  list_reading_lists: () => ({
    ok: true,
    data: useLibraryStore.getState().readingLists.map(describeReadingList),
  }),
  create_reading_list: (args) => handleCreateReadingList(args),
  update_reading_list: (args) => handleUpdateReadingList(args),
  delete_reading_list: (args) => handleDeleteReadingList(args),
  play_reading_list: (args) => handlePlayReadingList(args),
  set_language: (args) => handleSetLanguage(args),
  set_translation: (args) => handleSetTranslation(args),
  set_voice: (args) => handleSetVoice(args),
  set_playback_rate: (args) => handleSetPlaybackRate(args),
  set_music: (args) => handleSetMusic(args),
  set_reader_preferences: (args) => handleSetReaderPreferences(args),
  set_announcements: (args) => handleSetAnnouncements(args),
  set_mic_position: (args) => handleSetMicPosition(args),
  save_ribbon: (args) => handleSaveRibbon(args),
  continue_from_ribbon: (args, ctx) => handleContinueFromRibbon(args, ctx),
  enter_eyes_free_mode: () => handleSetEyesFree(true),
  exit_eyes_free_mode: () => handleSetEyesFree(false),
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
  // The registry's mapped type makes TOOL_REGISTRY[name] a union over all
  // handlers; widen to a single callable signature for the call. JSON args are
  // unknown at runtime regardless of the tool's declared arg type.
  const handler = TOOL_REGISTRY[name] as
    | ((args: unknown, ctx: DispatchContext) => ToolDispatchResult | Promise<ToolDispatchResult>)
    | undefined;
  if (!handler) return { ok: false, error: `unknown tool: ${name}` };
  try {
    return await handler(args, ctx);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Simple single-field setters (micro-handlers) ─────────────────────────

function handleSetLanguage(args: ToolArgs['set_language']): ToolDispatchResult {
  useSettingsStore.getState().setLocale(args.language);
  return { ok: true };
}

function handleSetTranslation(args: ToolArgs['set_translation']): ToolDispatchResult {
  useSettingsStore.getState().setTranslation(args.translation, true);
  return { ok: true };
}

function handleSetVoice(args: ToolArgs['set_voice']): ToolDispatchResult {
  useSettingsStore.getState().setVoice(args.voice);
  return { ok: true };
}

function handleSetMicPosition(args: ToolArgs['set_mic_position']): ToolDispatchResult {
  useSettingsStore.getState().setMicCorner(args.corner);
  return { ok: true, data: { corner: args.corner } };
}

function handleSetEyesFree(value: boolean): ToolDispatchResult {
  useGlobalVoiceStore.getState().setEyesFreeMode(value);
  return { ok: true };
}

async function handleReadVerses(
  args: { reference: string; translation?: Translation; immediate?: boolean },
  ctx: DispatchContext,
  autoplay: boolean,
): Promise<ToolDispatchResult> {
  const parsed = parseReference(args.reference);
  if (!parsed) return { ok: false, error: `could not parse reference "${args.reference}"` };
  // "read X now/sofort/jetzt" → hard-stop whatever is playing and read this
  // immediately, instead of appending to the queue (only meaningful when we
  // auto-play; lookup_verses passes autoplay=false).
  const immediate = autoplay && args.immediate === true;
  const { locale, translation: defaultTrans } = useSettingsStore.getState();
  const voice = effectiveReadingVoice();
  const voiceStyle = effectiveVoiceStyle();
  const translation = args.translation ?? defaultTrans;
  const verses = await getVerses(translation, parsed);
  if (verses.length === 0) return { ok: false, error: 'no verses found' };

  const summaries: VerseSummary[] = toVerseSummaries(
    translation,
    parsed.bookId,
    parsed.chapter,
    verses,
    locale,
  );

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
    if (await readingUsesBrowserVoice(plan)) {
      if (!ctx.signal?.aborted) {
        const items = planToBrowserItems(plan, ctx.messageId);
        // speakQueue replaces the active playlist (hard stop); enqueue appends.
        if (immediate) void browserTts.speakQueue(items);
        else void browserTts.enqueue(items);
      }
    } else {
      // Stream verses in as they're generated so the first plays promptly;
      // playQueue mode hard-stops for an immediate read, enqueue mode appends.
      void streamReading(
        plan,
        ctx.messageId,
        voice as OpenAiVoiceId,
        voiceStyle || undefined,
        ctx.signal,
        { mode: immediate ? 'playQueue' : 'enqueue' },
      );
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

/** How many chapters a draw may burn through before giving up. Only a chapter
 * the *draw* chose is ever redrawn, and only when the chosen translation
 * genuinely lacks it (versification gaps — see CLAUDE.md): the catalog is
 * English versification, so LUT has no Malachi 4 to read. A chapter the user
 * named is an error, not a redraw. */
const RANDOM_DRAW_ATTEMPTS = 5;

/** Ceiling on `count`. Each draw is a full reading queued behind the last, so
 * a mistyped 50 would be an hour of audio nobody asked for. */
const MAX_RANDOM_COUNT = 5;

/**
 * Draws `count` passages and reads them. One call per request rather than one
 * per passage: the pipeline drops a repeated draw with identical arguments (it
 * is how the model used to re-roll a request it thought had failed), so
 * "three random verses" has to be expressible in a single call.
 */
async function handleRandomPassage(
  args: ToolArgs['random_passage'],
  ctx: DispatchContext,
): Promise<ToolDispatchResult> {
  const count = Math.min(Math.max(Math.round(args.count ?? 1), 1), MAX_RANDOM_COUNT);
  const references: string[] = [];
  for (let i = 0; i < count; i++) {
    if (ctx.signal?.aborted) break;
    const drawn = await drawOnePassage(args, ctx);
    // A failed draw mid-way still reports what already played, so the model
    // isn't told the whole thing failed and prompted to try again.
    if (!drawn.ok) {
      return references.length > 0 ? drawnResult(references) : drawn;
    }
    const ref = (drawn.data as { reference?: string } | undefined)?.reference;
    if (ref) references.push(ref);
  }
  return drawnResult(references);
}

/**
 * The draw's report. `alreadyRead` and the note are there because the model's
 * reflex after a draw is to call `read_verses` for what it just got back — a
 * wasted round-trip at best, and for a multi-draw it invented a reference with
 * all three mashed together. The pipeline drops those reads either way; this
 * stops them being issued.
 */
function drawnResult(references: string[]): ToolDispatchResult {
  return {
    ok: true,
    data: {
      reference: references[0] ?? '',
      references,
      count: references.length,
      alreadyRead: true,
      note: `All ${references.length} requested passage(s) are already playing: ${references.join('; ')}. The request is fulfilled — do not call read_verses for them, do not draw again, and reply with empty content.`,
    },
  };
}

async function drawOnePassage(
  args: ToolArgs['random_passage'],
  ctx: DispatchContext,
): Promise<ToolDispatchResult> {
  const { translation: defaultTrans } = useSettingsStore.getState();
  const translation = args.translation ?? defaultTrans;
  const unit = args.unit ?? 'verse';

  // Book scope, when the user asked for one ("a random psalm").
  let bookId: number | undefined;
  if (args.book) {
    const found = findBookByName(args.book);
    if (!found) return { ok: false, error: `unknown book "${args.book}"` };
    bookId = found.id;
  }

  if (unit === 'book') {
    const book = bookId !== undefined ? getBookById(bookId) : pickRandomBook();
    if (!book) return { ok: false, error: `unknown book id ${bookId}` };
    // A whole book is thousands of verses of TTS, and auto-continuation carries
    // on from wherever a reading starts — so "pick me a book" opens it at 1:1
    // rather than queueing the lot.
    return handleReadVerses({ reference: `${book.nameEn} 1`, translation }, ctx, true);
  }

  // A chapter the user pinned is theirs: validate it, never redraw it.
  const fixedChapter = bookId !== undefined ? args.chapter : undefined;
  if (fixedChapter !== undefined) {
    const book = getBookById(bookId!);
    if (!book) return { ok: false, error: `unknown book id ${bookId}` };
    if (fixedChapter < 1 || fixedChapter > book.chapters) {
      return { ok: false, error: `chapter ${fixedChapter} out of range for ${book.nameEn}` };
    }
  }

  let lastError = '';
  for (let attempt = 0; attempt < RANDOM_DRAW_ATTEMPTS; attempt++) {
    const pick =
      fixedChapter !== undefined
        ? { bookId: bookId!, chapter: fixedChapter }
        : unit === 'chapter'
          ? pickUniformChapter(bookId)
          : pickWeightedChapter(bookId);
    const book = getBookById(pick.bookId);
    if (!book) return { ok: false, error: `unknown book id ${pick.bookId}` };

    // Whole-chapter reads go straight out; a verse draw needs the text anyway
    // to know how many verses this translation actually has. getChapter is
    // memoized, so handleReadVerses' own fetch below is free either way.
    let verses;
    try {
      verses = await getChapter(translation, pick.bookId, pick.chapter);
    } catch (e) {
      if (fixedChapter === undefined && isChapterMissing(e)) {
        lastError = `${book.nameEn} ${pick.chapter} not in ${translation}`;
        continue;
      }
      throw e;
    }
    if (verses.length === 0) {
      lastError = `no verses returned for ${book.nameEn} ${pick.chapter}`;
      if (fixedChapter === undefined) continue;
      return { ok: false, error: lastError };
    }

    // Delegate to the standard read flow so the user hears it and sees it.
    if (unit === 'chapter') {
      return handleReadVerses(
        { reference: `${book.nameEn} ${pick.chapter}`, translation },
        ctx,
        true,
      );
    }
    // The verse comes from the text that came back, not from the weight table,
    // so a translation with a shorter chapter can't yield a missing verse.
    const picked = verses[cryptoRandomInt(verses.length)];
    return handleReadVerses(
      { reference: `${book.nameEn} ${pick.chapter}:${picked.verse}`, translation },
      ctx,
      true,
    );
  }

  return {
    ok: false,
    error: `no readable chapter after ${RANDOM_DRAW_ATTEMPTS} draws (${lastError})`,
  };
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
    references: args.references.map(parseCardReferenceLine),
    notes: args.notes,
    color: 'yellow',
    textScale: args.textScale !== undefined ? clampTextScale(args.textScale) : undefined,
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
    references: args.references
      ? args.references.map(parseCardReferenceLine)
      : lookup.card.references,
    notes: args.notes ?? lookup.card.notes,
    textScale:
      args.textScale !== undefined ? clampTextScale(args.textScale) : lookup.card.textScale,
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

// ─── Reading lists ────────────────────────────────────────────────────────

/**
 * Parse the model's passage strings, reporting the ones that didn't resolve
 * rather than dropping them silently — a reading list with a hole in it is
 * worse than a tool call that says which line was wrong.
 */
function parsePassages(passages: string[]): { entries: ReadingEntry[]; rejected: string[] } {
  const entries: ReadingEntry[] = [];
  const rejected: string[] = [];
  for (const raw of passages) {
    const entry = parseReadingEntryLine(raw);
    // A book or a span becomes one entry per chapter, so "read Jonah" is four
    // things the user can tick off rather than one all-or-nothing item.
    if (entry) entries.push(...expandEntryToChapters(entry));
    else rejected.push(raw);
  }
  return { entries, rejected };
}

async function handleCreateReadingList(
  args: ToolArgs['create_reading_list'],
): Promise<ToolDispatchResult> {
  const rejected: string[] = [];
  const days: ReadingDay[] = [];

  // A rule beats an enumeration for anything long — see services/reading/readingPlan.
  if (args.plan) {
    const built = buildPlanDays(args.plan.cover ?? [], args.plan.days ?? 1);
    rejected.push(...built.unresolved);
    days.push(...built.days);
  }

  for (const day of args.days ?? []) {
    const parsed = parsePassages(day.passages ?? []);
    rejected.push(...parsed.rejected);
    days.push({ ...newReadingDay(day.title), entries: parsed.entries });
  }
  if (args.passages?.length) {
    const parsed = parsePassages(args.passages);
    rejected.push(...parsed.rejected);
    // A plain list is one untitled day — see the ReadingList type.
    days.push({ ...newReadingDay(), entries: parsed.entries });
  }
  if (days.length === 0) days.push(newReadingDay());
  if (days.every((d) => d.entries.length === 0)) {
    return {
      ok: false,
      error: rejected.length
        ? `no passage could be parsed (${rejected.join(', ')})`
        : 'a reading list needs at least one passage',
    };
  }

  const list: ReadingList = {
    ...newReadingList(args.name),
    description: args.description,
    days,
  };
  await useLibraryStore.getState().upsertReadingList(list);
  return {
    ok: true,
    data: { ...describeReadingList(list), rejected: rejected.length ? rejected : undefined },
  };
}

async function handleUpdateReadingList(
  args: ToolArgs['update_reading_list'],
): Promise<ToolDispatchResult> {
  const lookup = resolveReadingList(args.list);
  if (!lookup.ok) return { ok: false, error: lookup.error };
  let list = lookup.list;
  const rejected: string[] = [];

  if (args.name !== undefined) list = { ...list, name: args.name };
  if (args.description !== undefined) {
    list = { ...list, description: args.description || undefined };
  }

  if (args.addPassages?.length) {
    const parsed = parsePassages(args.addPassages);
    rejected.push(...parsed.rejected);
    const lastDay = list.days[list.days.length - 1];
    list = withEntriesAdded(list, lastDay.id, parsed.entries);
  }
  if (args.addDay?.passages?.length) {
    const parsed = parsePassages(args.addDay.passages);
    rejected.push(...parsed.rejected);
    const withDay = withDayAdded(list, args.addDay.title);
    const added = withDay.days[withDay.days.length - 1];
    list = withEntriesAdded(withDay, added.id, parsed.entries);
  }
  if (args.removePassages?.length) {
    const locale = useSettingsStore.getState().locale;
    for (const wanted of args.removePassages) {
      const target = parseReadingEntryLine(wanted);
      if (!target) {
        rejected.push(wanted);
        continue;
      }
      // Match on the formatted passage, so "Psalm 23:1-6" finds the entry
      // regardless of the note or translation the user attached to it.
      const text = formatReadingEntry(target, locale);
      const hit = listEntries(list).find((e) => formatReadingEntry(e, locale) === text);
      if (hit) list = withEntryRemoved(list, hit.id);
      else rejected.push(wanted);
    }
  }

  await useLibraryStore.getState().upsertReadingList(list);
  return {
    ok: true,
    data: { ...describeReadingList(list), rejected: rejected.length ? rejected : undefined },
  };
}

async function handleDeleteReadingList(
  args: ToolArgs['delete_reading_list'],
): Promise<ToolDispatchResult> {
  const lookup = resolveReadingList(args.list);
  if (!lookup.ok) return { ok: false, error: lookup.error };
  await useLibraryStore.getState().deleteReadingList(lookup.list.id);
  return { ok: true, data: { deleted: lookup.list.name } };
}

async function handlePlayReadingList(
  args: ToolArgs['play_reading_list'],
): Promise<ToolDispatchResult> {
  const lookup = resolveReadingList(args.list);
  if (!lookup.ok) return { ok: false, error: lookup.error };
  const list = lookup.list;
  if (listEntries(list).length === 0) {
    return { ok: false, error: `reading list "${list.name}" is empty` };
  }
  if (args.restart) {
    // Clearing the resume point is what "start over" means; the ticks stay, so
    // the user can still see what they have read.
    await useLibraryStore.getState().setCurrentEntry(list.id, undefined);
  }
  // Into the chat, not the reader: the reading appears where the user asked for
  // it, exactly like read_verses, and the list keeps playing as a list because
  // the appended message carries the entry's provenance. The list screen's own
  // Play button is the one that reads in the reader.
  const started = await playReadingListInChat(list.id);
  if (!started) {
    return {
      ok: false,
      error: `could not start "${list.name}" — its passages may not be available in the current translation`,
    };
  }
  return { ok: true, data: describeReadingList(list) };
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
  await useLibraryStore.getState().upsertBoard(withoutCardInBoard(board, cardId));
  return { ok: true, data: { boardId: board.id, boardName: board.name, cardId, cardTitle: cardLookup.card.title } };
}

async function handleArrangeCard(
  args: ToolArgs['arrange_card'],
): Promise<ToolDispatchResult> {
  const board = resolveBoard(args.board);
  if (!board) return { ok: false, error: `board "${args.board}" not found` };
  const cardLookup = resolveCard(args.card);
  if (!cardLookup.ok) return { ok: false, error: cardLookup.error };
  const cardId = cardLookup.card.id;
  // Spatial only — never alters membership. The card must already be on the board.
  if (!board.cardIds.includes(cardId)) {
    return {
      ok: false,
      error: `card "${cardLookup.card.title}" is not on board "${board.name}" — add it first with add_card_to_board`,
    };
  }
  // Base on the existing placement, or the deterministic auto-placement, so a
  // partial call (e.g. rotation only) leaves the other fields sensible.
  const base: FreeformCardLayout =
    board.freeform?.[cardId] ?? autoPlaceCard(cardId, board.cardIds.indexOf(cardId));
  const next: FreeformCardLayout = {
    x: args.x !== undefined ? clamp01(args.x) : base.x,
    y: args.y !== undefined ? clamp01(args.y) : base.y,
    w: args.width !== undefined ? clamp01(args.width) : base.w,
    h: args.height !== undefined ? clamp01(args.height) : base.h,
    rotation: args.rotation !== undefined ? args.rotation : base.rotation,
    z: base.z,
  };
  await useLibraryStore.getState().setCardLayout(board.id, cardId, next);
  return {
    ok: true,
    data: {
      boardId: board.id,
      boardName: board.name,
      cardId,
      cardTitle: cardLookup.card.title,
      layout: next,
    },
  };
}

function handleSetPlaybackRate(
  args: ToolArgs['set_playback_rate'],
): ToolDispatchResult {
  if (typeof args.rate !== 'number' || !Number.isFinite(args.rate)) {
    return { ok: false, error: 'rate must be a number' };
  }
  const rate = Math.max(0.25, Math.min(3, args.rate));
  audioPlayback.setPlaybackRate(rate);
  return { ok: true, data: { rate } };
}

async function handleSetMusic(
  args: ToolArgs['set_music'],
): Promise<ToolDispatchResult> {
  const setAmbient = useSettingsStore.getState().setAmbient;
  const setSpeechVolume = useSettingsStore.getState().setSpeechVolume;
  const result: Record<string, unknown> = {};

  if (args.enabled !== undefined) {
    setAmbient({ enabled: args.enabled });
    result.enabled = args.enabled;
  }

  if (args.track !== undefined) {
    const needle = args.track.trim().toLowerCase();
    if (!needle) return { ok: false, error: 'track must be non-empty' };
    let tracks;
    try {
      tracks = await getAmbientTracks();
    } catch {
      return { ok: false, error: 'could not load track list' };
    }
    const byId = tracks.find((t) => t.id === args.track);
    const byTitle = tracks.find(
      (t) => t.title.toLowerCase() === needle,
    );
    const byContains = tracks.find((t) =>
      t.title.toLowerCase().includes(needle),
    );
    const match = byId ?? byTitle ?? byContains;
    if (!match) {
      return {
        ok: false,
        error: `no track matched "${args.track}". Available: ${tracks.map((t) => t.title).join(', ') || '(none)'}`,
      };
    }
    setAmbient({ trackId: match.id });
    result.trackId = match.id;
    result.trackTitle = match.title;
  }

  if (args.musicVolume !== undefined) {
    const v = clamp01(args.musicVolume);
    setAmbient({ volume: v });
    audioPlayback.ambient.setVolume(v);
    result.musicVolume = v;
  }

  if (args.speechVolume !== undefined) {
    const v = clamp01(args.speechVolume);
    setSpeechVolume(v);
    audioPlayback.speech.setVolume(v);
    result.speechVolume = v;
  }

  if (Object.keys(result).length === 0) {
    return { ok: false, error: 'no music fields provided' };
  }
  return { ok: true, data: result };
}

function handleSetReaderPreferences(
  args: ToolArgs['set_reader_preferences'],
): ToolDispatchResult {
  const settings = useSettingsStore.getState();
  const result: Record<string, unknown> = {};
  if (args.autoPlay !== undefined) {
    settings.setAutoPlayReading(args.autoPlay);
    result.autoPlay = args.autoPlay;
  }
  if (args.autoScroll !== undefined) {
    settings.setAutoScrollReader(args.autoScroll);
    result.autoScroll = args.autoScroll;
  }
  if (args.repeat !== undefined) {
    audioPlayback.setLoopCurrent(args.repeat);
    result.repeat = args.repeat;
  }
  if (Object.keys(result).length === 0) {
    return { ok: false, error: 'no reader-preference fields provided' };
  }
  return { ok: true, data: result };
}

function handleSetAnnouncements(
  args: ToolArgs['set_announcements'],
): ToolDispatchResult {
  const settings = useSettingsStore.getState();
  const result: Record<string, unknown> = {};
  if (args.readChapterHeadings !== undefined) {
    settings.setReadChapterHeadings(args.readChapterHeadings);
    result.readChapterHeadings = args.readChapterHeadings;
  }
  if (args.readVerseNumbers !== undefined) {
    settings.setReadVerseNumbers(args.readVerseNumbers);
    result.readVerseNumbers = args.readVerseNumbers;
  }
  if (args.verseNumberStyle !== undefined) {
    if (args.verseNumberStyle !== 'spoken' && args.verseNumberStyle !== 'plain') {
      return { ok: false, error: 'verseNumberStyle must be "spoken" or "plain"' };
    }
    settings.setVerseNumberStyle(args.verseNumberStyle);
    result.verseNumberStyle = args.verseNumberStyle;
  }
  if (args.pauseBetweenVersesMs !== undefined) {
    settings.setPauseBetweenVersesMs(args.pauseBetweenVersesMs);
    result.pauseBetweenVersesMs =
      useSettingsStore.getState().pauseBetweenVersesMs;
  }
  if (args.pauseBetweenChaptersMs !== undefined) {
    settings.setPauseBetweenChaptersMs(args.pauseBetweenChaptersMs);
    result.pauseBetweenChaptersMs =
      useSettingsStore.getState().pauseBetweenChaptersMs;
  }
  if (Object.keys(result).length === 0) {
    return { ok: false, error: 'no announcement fields provided' };
  }
  return { ok: true, data: result };
}
