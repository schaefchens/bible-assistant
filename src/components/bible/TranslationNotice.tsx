import { Fragment } from 'react';
import clsx from 'clsx';
import type { Translation } from '@/services/bible/bibleApi';
import { getTranslationInfo } from '@/services/bible/translationCatalog';

type Props = { code: Translation; className?: string };

/**
 * A translation's copyright notice (translationCatalog `notice`), line for
 * line as the catalog has it, as Settings › Data & app › Bible texts lists
 * them. Not under each reading: the notices live in one place. Wording a rights
 * holder supplied is reproduced exactly, so this only lays it out and links its
 * URLs.
 */
export function TranslationNotice({ code, className }: Props) {
  const { notice } = getTranslationInfo(code);
  return (
    <div className={clsx('space-y-1.5', className)}>
      {notice.map((lines, p) => (
        <p key={p}>
          {lines.map((line, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              <NoticeLine line={line} />
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

const URL_PATTERN = /(https?:\/\/\S+)/;

/** One line, with any URL in it a link — and shown as written, not shortened. */
function NoticeLine({ line }: { line: string }) {
  // split() with a capture group keeps the matches, at the odd indices.
  return (
    <>
      {line.split(URL_PATTERN).map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted underline-offset-2 break-all hover:text-brand"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}
