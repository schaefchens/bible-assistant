import clsx from 'clsx';
import { BookIcon, ListIcon, QuillIcon } from '@/components/common/icons';
import type { ReaderSource } from '@/services/reading/readingSequence';

/**
 * The glyph for whatever the reader is walking through.
 *
 * The mapping lives with the picker rather than in the reader's header because
 * these are the picker's own marks — each one labels a row *in that sheet*. The
 * header's trigger has to answer with the same glyph the user tapped to get
 * there, and two copies of the mapping would drift apart the first time a
 * fourth kind of source exists.
 *
 * A selection ("everything new", "today from everyone") takes the quill too: it
 * is drawn from spaces, and a fourth mark would imply a fourth kind of thing.
 *
 * The size is normalised here because the three glyphs are drawn at different
 * sizes in the sheet, where they sit in separate rows — in the header they
 * share one slot and have to match.
 */
export function SourceIcon({
  source,
  className,
}: {
  source: ReaderSource;
  className?: string;
}) {
  const size = clsx('h-[18px] w-[18px]', className);
  if (source.kind === 'list') return <ListIcon className={size} />;
  if (source.kind === 'space' || source.kind === 'selection') return <QuillIcon className={size} />;
  return <BookIcon className={size} />;
}
