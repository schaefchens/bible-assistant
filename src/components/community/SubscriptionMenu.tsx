import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ReportDialog } from './ReportDialog';
import { ShareSpaceSheet } from './ShareSpaceSheet';
import { spaceSourceKey } from '@/services/reading/readingSequence';
import { useCommunityStore } from '@/store/communityStore';
import { useReaderStore } from '@/store/readerStore';

/**
 * What a reader can do about somebody else's space: stop reading it, report it,
 * or refuse its author outright.
 *
 * A menu rather than three inline links because two of the three are decisions
 * you should not be able to make by mis-tapping — block asks for a second tap,
 * and report opens a form.
 *
 * Blocking is the strong one: it removes *every* space of that author's, not
 * just this one, which is why the confirmation says so. It is keyed by the
 * pinned signing key, the only stable identity a reader has for an author.
 */
export function SubscriptionMenu({
  code,
  authorKey,
  ownerName,
  spaceLabel: label,
}: {
  code: string;
  authorKey: string;
  ownerName: string;
  spaceLabel: string;
}) {
  const { t } = useTranslation();
  const unsubscribe = useCommunityStore((s) => s.unsubscribe);
  const blockAuthor = useCommunityStore((s) => s.blockAuthor);
  const codesOfAuthor = useCommunityStore((s) => s.codesOfAuthor);
  const setSource = useReaderStore((s) => s.setSource);
  const source = useReaderStore((s) => s.source);
  const [open, setOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [sharing, setSharing] = useState(false);

  /** Don't leave the reader walking a space that is about to disappear. */
  const releaseReader = (codes: string[]) => {
    if (source.kind !== 'space') return;
    if (codes.some((c) => spaceSourceKey(source) === `c:${c}`)) {
      void setSource({ kind: 'bible' });
    }
  };

  return (
    <>
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
            setConfirmBlock(false);
          }}
          aria-label={t('boards.menu') as string}
          aria-expanded={open}
          className="text-ink-muted hover:text-ink px-2 leading-none"
        >
          ⋮
        </button>
        {open && (
          <>
            {/* Click-away as a sibling overlay: the row itself is a button, so
                a document listener would fight its onClick. */}
            <div
              className="fixed inset-0 z-30"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
            />
            <div
              className="absolute right-0 top-full mt-1 z-40 w-52 py-1 rounded-xl bg-surface-raised border border-surface-raised/70 shadow-lg"
              role="menu"
            >
              {/* First, and the only one here that isn't a complaint: a reader
                  who likes a space is the likeliest person to recommend it, and
                  what they pass on is the same code they were given. */}
              <MenuItem
                onClick={() => {
                  setOpen(false);
                  setSharing(true);
                }}
              >
                {t('community.shareSpace.action')}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setOpen(false);
                  setReporting(true);
                }}
              >
                {t('community.report.reportSpace')}
              </MenuItem>
              <MenuItem
                danger
                onClick={() => {
                  if (!confirmBlock) {
                    setConfirmBlock(true);
                    return;
                  }
                  setOpen(false);
                  releaseReader(codesOfAuthor(authorKey));
                  void blockAuthor(authorKey, ownerName);
                }}
              >
                {confirmBlock
                  ? t('community.blockAuthor.confirm', { name: ownerName })
                  : t('community.blockAuthor.action')}
              </MenuItem>
              {confirmBlock && (
                <p className="px-3 py-1.5 text-[11px] text-ink-muted">
                  {t('community.blockAuthor.confirmBody')}
                </p>
              )}
              <MenuItem
                onClick={() => {
                  setOpen(false);
                  releaseReader([code]);
                  void unsubscribe(code);
                }}
              >
                {t('community.unsubscribe')}
              </MenuItem>
            </div>
          </>
        )}
      </div>
      {reporting && (
        <ReportDialog code={code} title={label} onClose={() => setReporting(false)} />
      )}
      <ShareSpaceSheet
        code={code}
        title={label}
        open={sharing}
        onClose={() => setSharing(false)}
      />
    </>
  );
}

function MenuItem({
  onClick,
  danger,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={clsx(
        'w-full text-left px-3 py-2 text-sm hover:bg-surface',
        danger ? 'text-red-400' : 'text-ink',
      )}
    >
      {children}
    </button>
  );
}

