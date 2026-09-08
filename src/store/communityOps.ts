import { enqueueOp } from '@/store/syncQueueManager';
import { useLibraryStore } from '@/store/libraryStore';

/**
 * How a community write reaches the sync queue.
 *
 * Three lines of plumbing that every writer in this feature needs, and the
 * reason they are not in `communityStore` any more: with the writers split
 * across three modules, keeping these there would have meant each of those
 * modules importing the store they are spread into — the cycle
 * `communityRows` exists to document.
 *
 * They depend on `libraryStore` and nothing else community-shaped, so there is
 * nothing here to cycle *with*.
 */

export function online(): boolean {
  return useLibraryStore.getState().online;
}

export function flush(): void {
  if (online()) void useLibraryStore.getState().flushQueue();
}

/**
 * Enqueue one op and keep the pending count honest.
 *
 * `libraryStore`'s own writers adjust `pendingOps` inline from `enqueueOp`'s
 * return value; from out here a recount is simpler and cannot drift. Note that
 * `enqueueOp` drops the op entirely when sync is off, which is why the count
 * has to come from the queue rather than from the number of calls.
 */
export async function queued(op: Parameters<typeof enqueueOp>[0], payload: unknown): Promise<void> {
  await enqueueOp(op, payload);
  await useLibraryStore.getState().refreshPendingOps();
}
