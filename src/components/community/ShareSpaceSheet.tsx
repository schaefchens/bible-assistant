import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BottomSheet, BottomSheetBody } from '@/components/common/BottomSheet';
import { copyText, shareText } from '@/lib/nativeBridge';
import { formatSpaceCode } from '@/lib/spaceCode';
import { webInviteUrl } from '@/lib/spaceInvite';
import { shareCodeForSpace, shareLabelForSpace } from '@/services/community/spaceReading';
import { useCommunityStore } from '@/store/communityStore';

/**
 * Pass a space on: the link, or the code itself.
 *
 * **Readers get this too, not just owners**, which is the point of it existing
 * separately from the owner's share section in `SpaceDetail`. Somebody who
 * enjoys a space is the person most likely to recommend it, and until now the
 * only way they could was to read the code off a screen they had no reason to
 * open. What they hand on is exactly what they were given — the same code, the
 * same `/subscribe/<code>` link.
 *
 * It stays honest about what that buys the recipient: a code **locates** a
 * space, it does not open it (see "The share code is an address, not a key" in
 * CLAUDE.md). Whoever receives this still has to ask, and the owner still
 * decides — unless the owner set the space to auto-approval, in which case they
 * have already said the code is enough. A subscriber cannot see which of the
 * two it is (`Subscription` caches the space's kind, not its approval mode), so
 * the hint says what is true either way: they will be able to *ask*.
 *
 * **Rotating** a code stays out, in the space's own screen: it is the one share
 * action with a consequence — every current reader is cleared — and it belongs
 * next to the sentence that says so. Minting a *first* code does not, and
 * `ShareSpaceButton` does it on demand.
 */
export function ShareSpaceSheet({
  code,
  title,
  open,
  onClose,
}: {
  code: string;
  /** How the space is named back to the sharer — `Christoph / Heute`. */
  title: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const flash = (what: 'code' | 'link') => (ok: boolean) => {
    if (!ok) return;
    setCopied(what);
    window.setTimeout(() => setCopied(null), 1500);
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={t('community.shareSpace.title')}>
      <BottomSheetBody>
        <p className="text-sm text-ink-muted mb-4">{title}</p>

        {/* The code, big enough to read aloud down a phone — which is a real way
            these travel, and the reason the alphabet has no ambiguous letters. */}
        <p className="font-mono text-lg text-brand tracking-wide mb-3">
          {formatSpaceCode(code)}
        </p>

        <div className="flex gap-2 flex-wrap mb-4">
          {/* The link first: it is the one that works for someone who has never
              heard of the app, because /subscribe explains itself. */}
          <button
            type="button"
            onClick={() => void shareText(webInviteUrl(code))}
            className="btn-primary text-sm"
          >
            {t('community.shareSpace.sendLink')}
          </button>
          <button
            type="button"
            onClick={() => void copyText(webInviteUrl(code)).then(flash('link'))}
            className="px-3 py-1.5 rounded-lg bg-surface-raised text-sm text-ink-muted hover:text-ink transition-colors"
          >
            {copied === 'link' ? '✓' : t('community.shareSpace.copyLink')}
          </button>
          <button
            type="button"
            onClick={() => void copyText(formatSpaceCode(code)).then(flash('code'))}
            className="px-3 py-1.5 rounded-lg bg-surface-raised text-sm text-ink-muted hover:text-ink transition-colors"
          >
            {copied === 'code' ? '✓' : t('community.shareSpace.copyCode')}
          </button>
        </div>

        <p className="text-xs text-ink-muted/80">{t('community.shareSpace.hint')}</p>
      </BottomSheetBody>
    </BottomSheet>
  );
}

/**
 * The share affordance itself, for anywhere a space is on screen.
 *
 * Takes a **space id** rather than a code, and that is the whole reason it can
 * sit on the owner's own writing: three of Christoph's four spaces had a code
 * and the fourth did not, so a code-only button was simply missing from the one
 * space he had never got round to sharing — which is exactly the space someone
 * reaches for this button on. It now mints on the tap.
 *
 * Minting is not a decision being made behind anyone's back: a code creates an
 * *address*, not access (see "The share code is an address, not a key" in
 * CLAUDE.md), the tap is unambiguously "I want to share this", and the owner's
 * own screen offers the identical one-tap `shareCreate`. Rotating a code, which
 * really does have a consequence — every current reader is cleared — stays over
 * there with the sentence that says so.
 *
 * Still renders nothing when there is no code *and* the space is not the user's
 * to mint one for: a subscribed space whose feed has not been fetched yet.
 */
export function ShareSpaceButton({
  spaceId,
  className,
}: {
  spaceId: string | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  const shareSpace = useCommunityStore((s) => s.shareSpace);
  // Primitive selectors: a feed refresh re-runs them but re-renders nothing
  // unless the answer changed. `SegmentBlock` mounts one of these per piece.
  const code = useCommunityStore((s) => shareCodeForSpace(s, spaceId));
  const title = useCommunityStore((s) => shareLabelForSpace(s, spaceId));
  const mine = useCommunityStore((s) => !!spaceId && s.spaces.some((x) => x.id === spaceId));
  const [open, setOpen] = useState(false);
  const [minting, setMinting] = useState(false);
  const [minted, setMinted] = useState<string | null>(null);

  const shareCode = code ?? minted;
  if (!shareCode && !mine) return null;

  const onTap = async () => {
    if (shareCode) {
      setOpen(true);
      return;
    }
    // No code yet, and it is ours to make one for.
    setMinting(true);
    try {
      const fresh = await shareSpace(spaceId!);
      if (!fresh) return;
      setMinted(fresh);
      setOpen(true);
    } finally {
      setMinting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={minting}
        aria-label={t('community.shareSpace.action') as string}
        title={t('community.shareSpace.action') as string}
        onClick={(e) => {
          e.stopPropagation();
          void onTap();
        }}
        className={
          className ??
          'h-8 w-8 rounded-full flex items-center justify-center text-ink-muted hover:text-brand active:scale-95 transition-all disabled:opacity-40'
        }
      >
        <ShareIcon />
      </button>
      {shareCode && (
        <ShareSpaceSheet
          code={shareCode}
          title={title}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** The platform-neutral share mark: a node with two branches. Distinct from the
 * download arrow it sits beside in the reader. */
function ShareIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="2.6" />
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="19" r="2.6" />
      <path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3" />
    </svg>
  );
}
