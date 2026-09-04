/**
 * What every tool handler is handed and what every one gives back.
 *
 * Its own module so the handler files in `handlers/` and the routing table in
 * `dispatch.ts` can share it without importing each other.
 */

export type DispatchContext = {
  messageId: string;
  /** Aborted when the user issued a voice/text "stop". Tools that do
   * expensive work (TTS, audio enqueue) should bail out if it's set. */
  signal?: AbortSignal;
};

export type ToolDispatchResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
  /**
   * This tool put a reading into the **reader**, so the reader is where the
   * user should now be looking.
   *
   * Reported rather than acted on, because navigation belongs to a component:
   * `lib/` and `services/` cannot call the router, which is exactly how these
   * tools came to set the reader's source and position, start the audio, and
   * leave the user on the chat screen watching the previous turn's verse panel.
   * `useCommandPipeline` is a hook, so it can do the last step.
   *
   * Not inferable from the tool name: `read_verses` also reads, but into chat.
   */
  opensReader?: boolean;
};
