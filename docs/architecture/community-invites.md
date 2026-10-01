# Community — invitations and the opt-in

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

## Invite links

An invitation is still just a share code; a link is a way of delivering one.
Both shapes land on `/subscribe/<code>` (`routes/SubscribePage.tsx`), and
`lib/spaceInvite.ts` builds them.

**The route is the pending state.** A link can arrive before the app can act on
it — onboarding unfinished, no profile (one is required to subscribe), offline —
and none of that needs a stash, because the code sits in the URL: `AppShell`
renders the wizard *over* this route and the route is still matched when
onboarding finishes, and someone sent to Settings to make a profile returns to
the same link.

That last part is only true because the wizard's `onDone` **leaves the subscribe
route alone**. It resets to chat otherwise — a first run belongs there, not on
whatever stale URL was restored — and doing that unconditionally is what quietly
ate every invitation that arrived before onboarding was finished, `replace`
taking it out of history too so there was nothing to go back to. The link is
usually the reason that person installed the app at all.

**On mobile web the hand-off comes before the wizard**, not after. Web and
native are separate installs with separate identities, so onboarding someone
*before* they have said which one they want is setting up the wrong copy of the
app — and the common case is that the app is already installed and the link only
opened the browser on the way. So `AppShell` renders the invite route bare
(no nav, no dock — there is nothing to navigate to yet, and the app behind it is
not set up) whenever `needsAppHandOff()` and the user has not yet chosen to
stay. Choosing "continue in the browser" puts `?web=1` on the route, and from
there it is an ordinary first run that ends on the invitation.

That choice lives **in the URL**, for the same reason the code does: the route
is the pending state, so it survives the wizard, a reload, and the wizard's own
navigation without anyone having to remember it. `needsAppHandOff()` and
`stayingOnWeb()` are in `lib/spaceInvite.ts` rather than in the page because
`AppShell` has to reach the same answer — the two deciding differently is a
wizard that covers the hand-off, or a hand-off that never yields to it.

Desktop web and native both skip all of this: there is no app to hand off to,
and in the app you are already where the link was going. Both get the wizard
first and the invitation after.

**The invitation makes the profile itself.** A profile is genuinely required —
`space.request` refuses without one — but sending someone to Settings to build
one and find their own way back is a second setup wall in front of a person who
has just finished the first. So the no-profile branch of `SubscribePage` is a
name field plus the standards consent, and one button accepts, creates and asks
in that order (terms first, because `enableCommunity` refuses without them).
`joining` keeps that screen up for the whole compound action, so the confirm
sheet doesn't flash past on its way to "asked".

The wizard's community step therefore **opens ready to type when an invitation
is pending** (`location.pathname` is the subscribe route) rather than behind its
"set up" button, so most people never reach the branch above. It stays
skippable: that branch is the safety net, and it also catches the long-onboarded
user who never made a profile.

One layout note, since it bit immediately: `Sheet` centres with `m-auto`, not
`items-center`. Flex centring pushes overflow out of *both* ends of a scroll
box, so with the standards inside it the top of the sheet — title included —
became unreachable. Auto margins collapse to 0 when free space runs out, which
centres while it fits and scrolls when it doesn't.

**`space.peek` exists because `space.request` writes.** A "subscribe to X?"
confirmation built on `request` would be showing X only after having already
asked on the user's behalf, so peek is a read-only lookup — the one community
action that writes nothing, not in `$ACCOUNT_ACTIONS`, and it deliberately does
*not* require the caller to have a profile, since its whole job is to show the
invitation before anything is committed. `verifyBackend` asserts it creates no
membership.

**Mobile web gets an interstitial**, because a plain https link cannot hand over
to an installed app until App Links / Universal Links are configured. Three
things about it are deliberate:

- it is a **button, not a redirect** — whether the app is installed cannot be
  detected, and firing the scheme when it is not does nothing on iOS and can
  error on Android. A tap that quietly does nothing is survivable; an automatic
  error page for everyone without the app is not;
- **"Copy code" is not a nicety.** In-app browsers (WhatsApp, Instagram) often
  block scheme navigation, and that is exactly the channel these links travel;
- **it never subscribes.** Web and native are separate installs with separate
  identities, so a membership created there would belong to the *browser* — the
  app would still have no access and the author would see a request from someone
  who can never read. Whichever client the user lands in does the asking.

**The scheme is reverse-DNS** (`de.schaefchens.apps.bibleassistant`), matching
`appId`, because custom schemes are reserved nowhere: any app may claim
`bibleassistant://`, and two installed apps declaring the same one leaves iOS to
pick *undefinedly* while Android shows a chooser. It is a stopgap — App Links
and Universal Links are keyed to a domain whose ownership is proven, and once
either is configured the https link opens the app directly and the interstitial
stops being reached on that platform. Android needs
`.well-known/assetlinks.json` with the **Play App Signing** SHA-256 (the upload
key's is the wrong one) plus `autoVerify`, and both would need adding to
`scripts/deploy.sh`'s allow-list.

**The share sheet sends the https link alone.** It used to send the space's name
and the bare code on two further lines, so that a mangled link could still be
recovered by pasting the code — but a multi-line message is not a link: the OS
sheet offers it as *text* rather than as a URL, and the targets that do linkify
it pick the wrong span out of the three lines. The code is still shown beside
its own copy button in the space, for passing along by hand.

Input stays tolerant at that one boundary regardless: `parseSpaceCodeInput` takes
a bare code, either link, or a whole message with one embedded — being liberal
about what arrives costs nothing and older invitations are still out there.
`normalizeSpaceCode` and api.php's `normalizeShareCode` stay strict.

## Where the opt-in is offered

Three places, all progressive disclosure: the shelves screen itself, the Settings tile
(`components/settings/CommunitySection.tsx`) and a wizard step
(`components/onboarding/steps/CommunityStep.tsx`).

The form is **one component**, `components/community/CreateProfileForm.tsx` — a name, the
standards, one button — and the first two render it unchanged. `SubscribePage` keeps a
version of its own on purpose: its button accepts, creates *and* asks to read a shelf in
one press, and its copy is about the invitation the user is holding.

`/spaces` is now a **nav tab** (it took the slot Boards vacated), so the feature has a
way in that isn't Settings or a step of the wizard. It shows whether or not a profile
exists: without one the index renders **the opt-in form itself**, and a tab that says so
is the point — hiding it would keep the feature invisible to exactly the people who
haven't found it. It used to be a button to Settings, which dropped someone who had
already decided onto a screen of collapsed panes with nothing saying which one to open;
`support/community.ts`'s `makeProfile` now takes the inline path, so every sharing spec
walks it. The index therefore lost its back button (a tab root has
no parent); `/spaces/:id` keeps its own, whose fallback is that index. No badge on the
tab: `useCommunityRefresh` is deliberately not global, so a count there would be
either stale or bought with app-wide polling.

The step comes **after** `sync` and is last, because it *implies* sync —
`enableCommunity` turns it on, so asking first would enable something the next
screen had not offered yet. Skipping is a first-class outcome: the footer says
"Done" and nothing is created. The "this also turns on server sync" line shows
only while sync is still off, so it does not describe something the previous
step already did.

Adding a step means `OnboardingWizard`'s `steps` array and the progress dots grow
by one; the `Step` union is the only other place to touch.
