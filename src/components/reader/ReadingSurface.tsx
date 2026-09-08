import { useRef } from 'react';
import clsx from 'clsx';
import { useReadingSurface } from '@/hooks/useReadingSurface';
import type { ReadingAppearance } from '@/lib/readingAppearance';

type Props = {
  /** Override the stored appearance — the settings form's live preview passes
   *  the value being dragged. */
  appearance?: ReadingAppearance;
  className?: string;
  ref?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
};

/**
 * A `<div>` that scripture is printed on. Nothing but the text takes this: app
 * chrome keeps the app palette, so the controls that undo an unreadable setting
 * stay readable.
 *
 * Callers that already own their element (the chat verse panel is an `<article>`
 * with its own handlers) use `useReadingSurface` directly instead.
 */
export function ReadingSurface({ appearance, className, ref, children }: Props) {
  const own = useRef<HTMLDivElement>(null);
  const surfaceClass = useReadingSurface(own, appearance);

  return (
    <div
      ref={(node) => {
        own.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      className={clsx(surfaceClass, className)}
    >
      {children}
    </div>
  );
}
