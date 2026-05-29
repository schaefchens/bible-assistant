/** Move `fromId` to `toId`'s position in an order array, returning a new
 * array. Returns the input unchanged when the move is a no-op or either id is
 * missing — callers can pass the result straight to a setter that bails on an
 * unchanged order. */
export function reorderInArray(order: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return order;
  const fromIdx = order.indexOf(fromId);
  const toIdx = order.indexOf(toId);
  if (fromIdx === -1 || toIdx === -1) return order;
  const next = order.slice();
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

/** Reconcile a stored order against the items that actually exist: drop ids
 * that are unknown or duplicated, then append any items missing from the order
 * (in `items` order). Used so a card/board added or removed elsewhere can't
 * leave the order array stale. */
export function reconcileOrder(order: string[], items: { id: string }[]): string[] {
  const known = new Set(items.map((c) => c.id));
  const seen = new Set<string>();
  const kept = order.filter((id) => {
    if (!known.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  for (const c of items) {
    if (!seen.has(c.id)) {
      kept.push(c.id);
      seen.add(c.id);
    }
  }
  return kept;
}
