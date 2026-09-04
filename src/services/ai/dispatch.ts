import type { ToolName, ToolArgs } from './tools';
import type { DispatchContext, ToolDispatchResult } from './toolResult';
import {
  handleCreateReadingList,
  handleDeleteReadingList,
  handlePlayReadingList,
  handleUpdateReadingList,
  listReadingLists,
} from './handlers/readingLists';
import {
  handleAddCardToBoard,
  handleArrangeCard,
  handleCreateBoard,
  handleCreateCard,
  handleDeleteBoard,
  handleDeleteCard,
  handleRemoveCardFromBoard,
  handleReorderCards,
  handleUpdateCard,
  listBoards,
  listCards,
} from './handlers/library';
import {
  handleContinueFromRibbon,
  handleRandomPassage,
  handleReadVerses,
  handleSaveRibbon,
} from './handlers/reading';
import {
  handleListSpaces,
  handleReadNew,
  handleReadSpace,
  handleWritePost,
} from './handlers/spaces';
import {
  handleSetAnnouncements,
  handleSetEyesFree,
  handleSetLanguage,
  handleSetMicPosition,
  handleSetMusic,
  handleSetPlaybackRate,
  handleSetReaderPreferences,
  handleSetTranslation,
  handleSetVoice,
} from './handlers/settings';

/**
 * **The model's API, wired to its implementations — and nothing else.**
 *
 * The handlers themselves live in `handlers/`, one file per domain, because
 * this file used to hold all of them: 1,380 lines covering verse reading,
 * random draws, cards, boards, reading lists, spaces, ribbons and every
 * setting, which is a lot to read through to change one of them. The split is
 * by *what a tool acts on*, so the file to open follows from the tool name.
 */

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
  list_cards: () => listCards(),
  reorder_cards: (args) => handleReorderCards(args),
  create_board: (args) => handleCreateBoard(args),
  delete_board: (args) => handleDeleteBoard(args),
  add_card_to_board: (args) => handleAddCardToBoard(args),
  remove_card_from_board: (args) => handleRemoveCardFromBoard(args),
  arrange_card: (args) => handleArrangeCard(args),
  list_boards: () => listBoards(),
  list_reading_lists: () => listReadingLists(),
  create_reading_list: (args) => handleCreateReadingList(args),
  update_reading_list: (args) => handleUpdateReadingList(args),
  delete_reading_list: (args) => handleDeleteReadingList(args),
  play_reading_list: (args) => handlePlayReadingList(args),
  list_spaces: () => handleListSpaces(),
  write_post: (args) => handleWritePost(args),
  read_space: (args) => handleReadSpace(args),
  read_new: (args) => handleReadNew(args),
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
