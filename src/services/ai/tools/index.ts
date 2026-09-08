import type { ChatToolDefinition } from '@/services/api/chat';
import { READING_TOOLS, READING_READ_TOOLS, type ReadingToolArgs } from './reading';
import { LIBRARY_TOOLS, type LibraryToolArgs } from './library';
import {
  READING_LIST_TOOLS,
  READING_LIST_READ_TOOLS,
  type ReadingListToolArgs,
} from './readingLists';
import { SPACE_TOOLS, SPACE_READ_TOOLS, type SpaceToolArgs } from './spaces';
import { SETTINGS_TOOLS, SETTINGS_READ_TOOLS, type SettingsToolArgs } from './settings';

/**
 * The tool contract the model is handed — assembled from one module per
 * domain, which are **the same five domains as `services/ai/handlers/`**.
 *
 * It used to be one 996-line file: a hand-written `ToolName` union, a
 * hand-written `READ_TOOL_NAMES` set, a 102-line `ToolArgs` map, a 749-line
 * `TOOL_DEFINITIONS` array and the two system prompts. A tool's schema and its
 * implementation therefore sat at wildly different granularities — you edited
 * `handlers/spaces.ts` (167 lines) and then went hunting in the array.
 * `dispatch.ts` had already been split this way; this file was missed.
 *
 * **To add a tool, touch two files.** Declare it in its domain module here
 * (args entry + definition, and its read-tool list if the effect is audio),
 * then add one entry to `TOOL_REGISTRY` in `dispatch.ts`. Nothing else.
 *
 * The prompts moved to `../prompts.ts`: they are prose rules about model
 * behaviour, not tool schemas.
 */

/**
 * Every tool's argument shape, keyed by name.
 *
 * An intersection rather than one written-out map, which is what makes
 * {@link ToolName} derivable — see below.
 */
export type ToolArgs = ReadingToolArgs &
  LibraryToolArgs &
  ReadingListToolArgs &
  SpaceToolArgs &
  SettingsToolArgs;

/**
 * **Derived, not listed.** The union used to be forty hand-maintained lines
 * sitting well away from the definitions it had to agree with; now a tool
 * added to a domain module joins it automatically.
 *
 * That matters beyond tidiness: `dispatch.ts`'s `TOOL_REGISTRY` is a mapped
 * type over this union, so a tool with no handler is a **compile error**. With
 * the union hand-written, a new tool could be declared, shipped to the model,
 * and dispatched to nothing — the mapped type would happily agree with the
 * list that had also forgotten it.
 */
export type ToolName = keyof ToolArgs;

export const TOOL_DEFINITIONS: ChatToolDefinition[] = [
  ...READING_TOOLS,
  ...LIBRARY_TOOLS,
  ...READING_LIST_TOOLS,
  ...SPACE_TOOLS,
  ...SETTINGS_TOOLS,
];

/**
 * The tools whose effect is "read Bible text aloud". `useCommandPipeline`
 * treats these specially: the verse audio **is** the reply, so chat text is
 * suppressed, and a repeated read of the same passage in one turn is deduped.
 *
 * Contributed per domain rather than listed here, so a domain that gains a
 * reading tool cannot forget to tell the pipeline — the alternative is a new
 * tool that plays audio *and* narrates what it just played.
 */
export const READ_TOOL_NAMES: ReadonlySet<ToolName> = new Set<ToolName>([
  ...READING_READ_TOOLS,
  ...READING_LIST_READ_TOOLS,
  ...SPACE_READ_TOOLS,
  ...SETTINGS_READ_TOOLS,
]);

export function isReadTool(name: ToolName): boolean {
  return READ_TOOL_NAMES.has(name);
}
