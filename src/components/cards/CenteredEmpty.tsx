/** A centered "nothing here yet" panel with one call to action. Shared by the
 * All-cards and board bodies so the two empties read as the same screen. */
export function CenteredEmpty({
  text,
  ctaLabel,
  onCta,
  hint,
}: {
  text: string;
  ctaLabel: string;
  onCta: () => void;
  /** Quieter second way in, below the button. An empty board is where the
   * drag-a-card-onto-the-tab gesture is worth mentioning, since a gesture
   * nothing announces is a gesture nobody finds. */
  hint?: string;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <p className="text-ink-muted max-w-xs">{text}</p>
      <button onClick={onCta} className="btn-primary text-base px-6 py-3 rounded-xl mt-2">
        + {ctaLabel}
      </button>
      {hint && <p className="text-ink-muted/70 text-xs max-w-[15rem] leading-relaxed">{hint}</p>}
    </div>
  );
}
