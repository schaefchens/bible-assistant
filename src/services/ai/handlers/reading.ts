import { audioPlayback } from '@/lib/audioPlaybackManager';
import { browserTts } from '@/lib/browserTts';
import { cryptoRandomInt } from '@/lib/cryptoRandom';
import { buildPlaybackPlan } from '@/lib/playbackPlan';
import {
  planToBrowserItems,
  readingUsesBrowserVoice,
  startAmbientIfEnabled,
  streamReading,
} from '@/lib/startPlayback';
import { getChapter, getVerses, type Translation } from '@/services/bible/bibleApi';
import {
  findBookByName,
  formatRangeList,
  formatReference,
  getBookById,
} from '@/services/bible/bookCatalog';
import { isChapterMissing } from '@/services/bible/chapterSources';
import {
  advanceOneVerse,
  resolveLastReadVerse,
  type ResolvedPosition,
} from '@/services/bible/playbackPosition';
import {
  pickRandomBook,
  pickUniformChapter,
  pickWeightedChapter,
} from '@/services/bible/randomPassage';
import { parseReference } from '@/services/bible/referenceParser';
import { toVerseSummaries } from '@/services/bible/verseSummaries';
import { useChatStore } from '@/store/chatStore';
import {
  effectiveReadingVoice,
  effectiveVoiceStyle,
  useSettingsStore,
} from '@/store/settingsStore';
import { useRibbonsStore, type RibbonColor, RIBBON_COLORS } from '@/store/ribbonsStore';
import type { OpenAiVoiceId, VerseSummary } from '@/types/domain';
import type { ToolArgs } from '../tools';
import type { DispatchContext, ToolDispatchResult } from '../toolResult';

/**
 * The tools that read scripture aloud, and the ribbons that mark where you
 * stopped. Reading *is* the reply for these: a pure `read_verses` turn emits no
 * chat text, only audio (logged as a `historyNote` so the model can later
 * "continue reading").
 */

export async function handleReadVerses(
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
export async function handleRandomPassage(
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

export async function handleSaveRibbon(
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

export async function handleContinueFromRibbon(
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
