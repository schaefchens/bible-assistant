# In-app feedback — the bug button

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

A round beetle tucked into the right edge of every screen; tapping it opens one
modal that sends a bug report, a feature request, or a plain remark to the
maintainer. `src/components/feedback/*`, `src/lib/feedbackContext.ts`,
`src/services/api/feedback.ts`, and `feedback.create` in api.php.

**Where it sits is the whole design**, and it is the one thing to re-check before
moving it:

- all four *floating* positions of the mic dock are corners, and its snap targets
  and drag ghost live there too — so no corner is free of whichever one the user
  picked;
- vertically centred, it clears every page header and every page's own bottom bar
  (the chat composer, the reader's pager) without knowing which page is mounted
  and without reading `bottomBarHeight`;
- the **right** edge, not the left, because on mobile web the left edge is the
  browser's back-swipe region, and a control you have to press should not be
  fighting a navigation gesture for the same pixels;
- **hung 12px off the edge**, because the reader's text column runs to 16px from
  the viewport edge at every width. Fully on-screen there, a 40px circle covers
  the last 30px of two lines of scripture — measured, not guessed. Tucked, that
  halves to 16px while a 32px-wide lens of a 44px-tall circle stays visible,
  which is still a comfortable target. Narrower buys a few pixels of text and
  costs the tap;
- `z-30`, so it sits under every sheet, modal and the dock itself (z-40 / z-50)
  and can never cover a decision in progress — including its own dialog.

`settings.feedbackEnabled` hides it, **defaulting to on for every install,
existing ones included**: this is how the app asks for the feedback it needs
while it is being tested, and an off-by-default report channel gathers nothing.
There is no migration and the persist version is unchanged — zustand's default
merge is shallow, so a field absent from persisted state keeps the initializer's
value, and a migration would have written `true` over `true`.

**The kind is asked first and it changes the prompt**, because "what's on your
mind?" and "what went wrong, and what did you expect?" collect very different
text. One box either way: a bug form with a title, steps and an expected-result
field collects nothing at all from a tester on a phone.

**The diagnostics are collected, not asked** (`collectFeedbackContext`): route,
build commit, build time, platform, locale, viewport and online state. Every one
is a question the maintainer would otherwise have to ask back, and there is no
reply channel in the app — so a report needing a follow-up is a report that dies.
Two consequences: the dialog *shows* the lot before sending, since it is a device
fingerprint; and the **user agent is taken from the request, not the body**, where
it cannot be wrong.

## Why it is outside sync, and outside the account

`settings.syncEnabled` gates *the user's library* at three chokepoints, and
`$ACCOUNT_ACTIONS` is what brings a server directory into existence. `feedback.create`
is in neither, deliberately: the whole point of a bug button is that it works for
the tester whose app is broken and for the one who never opted into sync. Nothing
it writes goes under `storage/users/` — `verifyBackend.mjs` asserts exactly that,
because it is the kind of property a later refactor breaks silently.

It needs no profile either, unlike `report.create` and `space.request`: those are
about somebody else's writing, and this is about the app.

Nothing is queued when a send fails. The text stays in the textarea and retrying
is the whole recovery, which is both honest and what `ReportDialog` does — a
queued feedback op would be an op with no entity behind it.

## The server side

`storage/feedback/{userId}/` — HTTP-denied like `users/`, `shares/`, `reports/`
and `moderation/`, since it holds user-authored text plus a device fingerprint.
Three rules, all in `handleFeedbackCreate`:

- **the context is whitelisted, not stored as sent** — every field lands in front
  of a human, and a client may put anything in the body;
- **one file per (identity, kind, message)**, keyed by hash, so re-tapping send
  after a request that actually succeeded overwrites instead of piling up. Order
  lives in `reportedAt` inside the file, not in the filename;
- **a per-identity cap** (`MAX_FEEDBACK_PER_USER`), counted from that user's own
  directory — which is the reason for the per-identity sub-directory. There is no
  rate limiting anywhere in api.php, and this is the one write a stranger can
  reach with nothing set up at all. The cap bounds *new* files only, so a
  correction to something already sent still gets through.
