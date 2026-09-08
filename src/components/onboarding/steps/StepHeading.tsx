/** Centered title + subtitle shown at the top of each onboarding step. */
export function StepHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-8 text-center">
      <h2 className="text-2xl font-serif text-brand mb-2">{title}</h2>
      <p className="text-sm text-ink-muted">{subtitle}</p>
    </div>
  );
}
