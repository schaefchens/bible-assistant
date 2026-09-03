import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settingsStore';
import { FeedbackDialog } from './FeedbackDialog';

/**
 * The floating bug button: one tap from anywhere to "something's wrong here".
 *
 * **Where it sits is the whole design.** Mid-way down the right edge, which is
 * the one strip of the viewport nothing else in this app claims:
 *
 *  - all four floating positions of the mic dock are *corners*, and its snap
 *    targets and drag ghost live there too, so a corner would collide with
 *    whichever one the user picked — and there is no position left that all
 *    four avoid;
 *  - vertically centred, it clears every page header and every page's own
 *    bottom bar (the chat composer, the reader's pager) without having to know
 *    which page is mounted or read `bottomBarHeight`;
 *  - the right edge rather than the left, because on mobile web the left edge
 *    is the browser's back-swipe region, and a control you have to press
 *    should not be fighting a navigation gesture for the same pixels.
 *
 * **It is tucked past the edge on purpose.** The reader's text column runs to
 * 16px from the viewport edge at every width, so a floater sitting fully
 * on-screen there covers the last ~30px of two lines of scripture — measured,
 * not guessed. Hanging the circle 12px off the right edge halves that to 16px
 * while keeping a 32px-wide lens of it visible, which is still a comfortable
 * target because it is a full 44px tall. Going narrower than that buys a few
 * pixels of text and costs the tap, so this is where the trade lands; the
 * translucent fill is the rest of the answer, and the setting is the way out
 * for anyone who disagrees.
 *
 * `z-30` puts it under every sheet, modal and the dock itself (z-40/z-50), so
 * it can never cover a decision the user is in the middle of — including its
 * own dialog. Dimmed until touched for the same reason it is small: it is
 * always present, on every screen, and a report button that competes with the
 * scripture is the wrong trade.
 *
 * Gated on `settings.feedbackEnabled` here rather than at the mount site, the
 * way `MicDock` reads its own position: one component, one answer.
 */
export function FeedbackButton() {
  const { t } = useTranslation();
  const enabled = useSettingsStore((s) => s.feedbackEnabled);
  const [open, setOpen] = useState(false);

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('feedback.open') as string}
        title={t('feedback.open') as string}
        className={
          'fixed -right-3 top-1/2 -translate-y-1/2 z-30 ' +
          'h-11 w-11 rounded-full grid place-items-center pr-3 ' +
          'bg-surface-raised/85 text-brand border border-brand/30 shadow-lg ' +
          'opacity-70 transition-opacity duration-200 ' +
          'hover:opacity-100 focus-visible:opacity-100 active:opacity-100'
        }
      >
        <BugIcon />
      </button>
      {open && <FeedbackDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** A beetle: body, head, antennae and three legs a side. Same stroke idiom as
 * the nav icons — it has to read as chrome at 20px. */
function BugIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
      aria-hidden="true"
    >
      <path d="M12 20.5c-3.3 0-6-2.7-6-6v-3.2A4.3 4.3 0 0 1 10.3 7h3.4A4.3 4.3 0 0 1 18 11.3v3.2c0 3.3-2.7 6-6 6z" />
      <path d="M9.2 7V6a2.8 2.8 0 0 1 5.6 0v1" />
      <path d="M8.4 2.6 10.1 4.3" />
      <path d="M15.6 2.6 13.9 4.3" />
      <path d="M12 20.5V10.5" />
      <path d="M6 10.5H2.5" />
      <path d="M6 14.5H3" />
      <path d="M6.6 18.4 4 20.4" />
      <path d="M18 10.5h3.5" />
      <path d="M18 14.5h3" />
      <path d="M17.4 18.4 20 20.4" />
    </svg>
  );
}
