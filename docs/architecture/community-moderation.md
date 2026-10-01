# Moderation — the four things a shared-writing feature owes its users

> Part of the architecture notes indexed in [`CLAUDE.md`](../../CLAUDE.md). Moved there verbatim; "above" and "below" may refer to sections that now live in a sibling file.

Sharing other people's writing brings Apple guideline 1.2 and the Play UGC
policy into scope, and both ask for the same four things. All four exist now.

**1. Accepted content standards, before anything is published.**
`settings.communityTermsVersion` records which version the user accepted; 0 is
never. The text lives under `community.terms.*` in the locales and is rendered
by one component (`CommunityTerms`) everywhere it appears, because a rule worded
differently in one place is a rule nobody can be held to.
`lib/communityTerms.ts` owns the version and the two ways to ask about it.

Nothing backfills the acceptance, deliberately: an install that switched the
community on before the standards existed has not agreed to them. So
`SpacesPage` renders `CommunityTermsGate` **instead of** every community screen
while a profile exists without an acceptance — the gate sits above the space
editor and the post editor too, which is why it is placed before those branches
rather than inside the index. `SubscribePage` shows the same gate, so an
invitation survives the detour (its code is in the URL). Accepting is one tap;
leaving is offered beside it, because a gate with one exit is a demand.

`enableCommunity` and `subscribe` refuse without it as well, the way the
`syncEnabled` chokepoints do: a new caller cannot switch the feature on by
forgetting to ask.

**2. Blocking an author** (`communityStore.blockAuthor`) is keyed by the
author's **signing key**, not by space or share code. That key is derived from
their mnemonic, so it is the same in every space they own — which is what lets
one tap take *all* of them out, and a share code could never do. It needs no
server support, and that is not a shortcut: nobody can push anything at a reader
here (a subscriber *pulls* `space.feed`), so removing the subscriptions and
refusing to add them back is a complete block from the reading side. `subscribe`
matches the block list against the code's own fingerprint *before* asking, so a
blocked author never even gets a membership row appended in their file. The
author is not told.

The list is a local `preferences` row. The subscription deletes sync, so the
spaces disappear from the user's other devices; "don't let them back in" is
remembered per device. Syncing it would want a server action and a merge rule
for a list whose whole purpose is to be enforced offline.

**3. Reporting** (`ReportDialog` → `report.create`) is offered on the piece, in
the reader, and on the space, in the subscription row's menu. On the piece
because that is where the offending text is — under endless scroll a header
control could only ever mean "the one I guess you mean". The reasons are the
content standards restated as choices: a report form whose options don't line up
with the rules produces reports a moderator cannot act on.

Server-side it is the third action that crosses accounts and the only one
addressed to neither party — `storage/reports/` is HTTP-denied, so the author can
neither see that they were reported nor delete what was said. Three things about
it are deliberate: **the reported text is snapshotted** (deleting the piece is
the obvious first move after being reported), **one file per (reporter, target)**
so re-reporting overwrites instead of piling up, and **a profile is required**,
since you cannot see somebody else's writing without one.

**4. Automated moderation, before a piece is ever published.**
`MODERATION_POLICY` in api.php is the server's copy of the standards — a *mirror
of `community.terms.*`*, so changing the rules means changing both and bumping
`COMMUNITY_TERMS_VERSION`. `moderationJudge()` asks for a JSON verdict on
`MODERATION_MODEL` (`gpt-4o`, not the chat's `gpt-4o-mini`): the chat's job is
corrected by the user in the next breath, the moderator's job is to refuse
somebody's writing, and a wrong call there is either published abuse or a
silenced author.

Five things hold it up:

- **The policy explicitly protects Scripture.** The Bible contains war, sex and
  politics; a judge told only "no violence, no sexual content, nothing
  political" refuses Judges, the Song of Songs and half the prophets. The
  carve-out in the middle of the policy is what makes the feature usable at all.
- **It runs server-side, in the write path.** A check the client performs is a
  check a modified client skips. The client asks the same question first
  (`moderation.check`) *only* so the refusal can be shown at the publish tap:
  publishing rides the sync queue, where a 422 would otherwise surface as a
  piece that silently never shared. The flush path handles that case anyway, by
  dropping the `shared` claim along with the op.
- **It fails open.** No key, no network or an unparseable answer publishes the
  piece and records the verdict as *unchecked* rather than caching it as
  approved. Refusing every publish while OpenAI is unreachable turns an outage
  into a total outage; reporting and a human moderator stand behind this.
- **Verdicts are cached by content** under `storage/moderation/`, like generated
  speech, because the same text is judged up to three times (the ask, the write,
  a later re-share). `temperature: 0` for the same reason: an author who fixes a
  typo must not get a different answer.
- **It always uses the shared key**, never the caller's own. Billing an author
  for the judging of their own post is odd, and a user who removed their key
  would otherwise have switched moderation off.

Reports get that same judge as a **triage, not a filter**: a plausible report is
filed in `storage/reports/` for a human, an implausible one in
`storage/reports/unfounded/`, and **the reporter is told the same thing either
way**. Telling someone a model dismissed their report teaches them to stop
reporting, and teaches an abuser what passes. Nothing is deleted, because the
judge is wrong sometimes.

`MODERATION_STUB` in `secrets.php` short-circuits the judge with a fixed
verdict. That is the seam `verifyBackend.mjs` drives — the refusal half cannot be
tested against a live model — and it doubles as a kill switch. A stubbed verdict
deliberately bypasses the cache in both directions, so flipping it changes the
answer.
