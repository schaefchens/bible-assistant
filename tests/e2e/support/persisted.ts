import { expect, type Page } from '@playwright/test';

/**
 * Wait until reading progress has actually reached IndexedDB.
 *
 * **Why this is needed, and why it is not a sleep.** `libraryStore`'s
 * `updateProgress` updates the store *before* awaiting the Dexie write:
 *
 *     set((s) => ({ readingProgress: … }));          // UI says "1 of 2 read"
 *     await db.readingProgress.put({ …next, dirty: 1 });
 *
 * That is ordinary optimistic UI, and deliberate — the read and the write share
 * one synchronous block so two writers in the same tick cannot drop each
 * other's ticks. But it means the screen is a signal that the tick was
 * *accepted*, not that it was *stored*. A spec that reads the screen and then
 * reloads is racing the write, and will lose sometimes.
 *
 * So this waits on the durable thing instead. It makes the assertion stronger
 * rather than weaker: reloading after this proves the record was persisted and
 * re-read, which is the whole claim.
 */
export async function progressPersisted(page: Page, entries = 1): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const req = indexedDB.open('bible-assistant');
              req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('readingProgress')) return resolve(0);
                const all = db.transaction('readingProgress').objectStore('readingProgress').getAll();
                all.onsuccess = () =>
                  resolve(
                    (all.result as { completed?: string[] }[]).reduce(
                      (n, row) => n + (row.completed?.length ?? 0),
                      0,
                    ),
                  );
                all.onerror = () => resolve(0);
              };
              req.onerror = () => resolve(0);
            }),
        ),
      { timeout: 15_000, message: 'reading progress never reached IndexedDB' },
    )
    .toBeGreaterThanOrEqual(entries);
}
