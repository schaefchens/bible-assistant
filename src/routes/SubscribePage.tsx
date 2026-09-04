import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ROUTES } from '@/lib/appRoutes';
import { copyText } from '@/lib/nativeBridge';
import { formatSpaceCode, keyFingerprint, parseSpaceCodeInput } from '@/lib/spaceCode';
import {
  appInviteUrl,
  needsAppHandOff,
  STAY_ON_WEB_PARAM,
  stayingOnWeb,
} from '@/lib/spaceInvite';
import { extractErrorDetail } from '@/lib/extractErrorDetail';
import { peekSpace, type SpacePeekResponse } from '@/services/api/community';
import { isOwnCode, useCommunityStore } from '@/store/communityStore';
import { COMMUNITY_TERMS_VERSION, useCommunityTermsAccepted } from '@/lib/communityTerms';
import { CommunityTermsConsent } from '@/components/community/CommunityTerms';
import { useSettingsStore } from '@/store/settingsStore';
import { CommunityTermsGate } from '@/components/community/CommunityTermsGate';


/** The refusals both submit paths below can raise, each with its own message
 * under `community.errors.*`. Anything else falls back to the generic one. */
const KNOWN_ERRORS = [
  'invalid_code',
  'unknown_code',
  'key_mismatch',
  'profile_required',
  'space_not_ready',
  'terms_required',
  'author_blocked',
  'own_space',
];

/**
 * The server's word for a code it cannot resolve. Not a message key — it comes
 * back as prose — so it is folded to one here rather than at each call site.
 */
const UNKNOWN_CODE = 'unknown share code';

/**
 * Which `community.errors.*` key a thrown refusal should be shown as.
 *
 * One helper for all three catch blocks (the peek, the ask, and the
 * make-a-profile-and-ask), because they previously mapped the same thrown
 * strings three slightly different ways — which is how "unknown share code"
 * came to be shown as "that does not look like a share code". Returns null when
 * there is no known key, leaving the caller to fall back to the server's own
 * detail.
 */
function errorKeyFor(e: unknown): string | null {
  const raw = e instanceof Error ? e.message : '';
  if (raw === UNKNOWN_CODE) return 'unknown_code';
  return KNOWN_ERRORS.includes(raw) ? raw : null;
}

/**
 * `/subscribe/:code` — where an invitation lands.
 *
 * **The route is the pending state.** A link can arrive before the app can act
 * on it: onboarding unfinished, no profile yet (one is required to subscribe),
 * offline. None of that needs a stash, because the code sits in the URL —
 * `AppShell` shows the wizard over this route and the route is still matched
 * when onboarding finishes, and a user sent to Settings to make a profile can
 * come back to the same link.
 *
 * On mobile web it first offers to hand over to the installed app, because a
 * plain https link cannot do that by itself until App Links / Universal Links
 * are configured. Three things about that interstitial are deliberate:
 *
 * - **It is a button, not a redirect.** Whether the app is installed cannot be
 *   detected, and firing the scheme when it is not does nothing on iOS and can
 *   show an error on Android. A tap that quietly does nothing is survivable; an
 *   automatic error page for everyone without the app is not.
 * - **"Copy code" is a first-class option, not a nicety.** In-app browsers
 *   (WhatsApp, Instagram) often block scheme navigation, and that is exactly
 *   the channel these links travel through. The app always accepts a pasted
 *   code, so this is a complete escape hatch.
 * - **It never subscribes.** Web and native are separate installs with separate
 *   identities, so a membership created here would belong to the *browser* — the
 *   app would still have no access, and the author would see a request from
 *   someone who can never read. Whichever client the user ends up in does the
 *   asking, with its own identity.
 */
export function SubscribePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { code: raw } = useParams<{ code?: string }>();

  const code = parseSpaceCodeInput(raw ?? '');
  const profile = useCommunityStore((s) => s.profile);
  const subscribe = useCommunityStore((s) => s.subscribe);
  const enableCommunity = useCommunityStore((s) => s.enableCommunity);
  const acceptTerms = useSettingsStore((s) => s.acceptCommunityTerms);
  const initialized = useCommunityStore((s) => s.initialized);
  const blocked = useCommunityStore((s) => s.blocked);
  const spaces = useCommunityStore((s) => s.spaces);
  const termsAccepted = useCommunityTermsAccepted();
  const existing = useCommunityStore((s) =>
    code ? s.subscriptions.find((x) => x.code === code) : undefined,
  );

  // Derived from the route, not held in state: `AppShell` reads the same
  // answer to decide whether this sheet or the onboarding wizard comes first,
  // and the choice has to survive the wizard, a reload and the wizard's own
  // navigation. `needsAppHandOff()` is "mobile web" — in the app we are already
  // where the link was trying to get to, and on a desktop there is no app.
  const location = useLocation();
  const handOff = needsAppHandOff() && !stayingOnWeb(location.search);
  const stayHere = () =>
    navigate(`${ROUTES.subscribe}/${raw ?? ''}?${STAY_ON_WEB_PARAM}=1`, {
      replace: true,
    });

  const [peek, setPeek] = useState<SpacePeekResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The code is well-formed but names no space, so asking cannot succeed. */
  const [unresolved, setUnresolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  const [copied, setCopied] = useState(false);
  // Making the profile here rather than in Settings — see the branch below.
  const [joinName, setJoinName] = useState('');
  const [joinAgreed, setJoinAgreed] = useState(false);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!code || handOff) return;
    let cancelled = false;
    peekSpace(code)
      .then((res) => {
        if (!cancelled) setPeek(res);
      })
      .catch((e) => {
        if (cancelled) return;
        const key = errorKeyFor(e);
        // "unknown share code" is not "malformed share code", and saying the
        // latter sends someone hunting for a typo in a code they pasted
        // correctly. A well-formed code the server cannot resolve has usually
        // been rotated away since it was sent, so it gets its own message —
        // and `unresolved` disables the ask, because `space.request` would fail
        // on the same lookup. Anything else may be transient (offline above
        // all), so the button stays live to retry.
        if (key === 'unknown_code') setUnresolved(true);
        setError(
          key ? t(`community.errors.${key}`) : (extractErrorDetail(e) ?? t('community.errors.failed')),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [code, handOff, t]);

  /**
   * Create the profile and ask to read, in one action.
   *
   * An invitation is the one place where the community profile is not optional:
   * it is the entire reason the link was opened. This used to be a sheet whose
   * only button pushed the user into Settings to build a profile and find
   * their own way back, which is a second setup wall in front of someone who
   * has just finished the first one.
   *
   * Terms before profile, because `enableCommunity` refuses without them — and
   * the checkbox on this screen is where they were accepted.
   */
  const createProfileAndAsk = async () => {
    const displayName = joinName.trim();
    if (!code || joining || !displayName || !joinAgreed) return;
    setJoining(true);
    setError(null);
    try {
      acceptTerms(COMMUNITY_TERMS_VERSION);
      await enableCommunity(displayName);
      await subscribe(code);
      setAsked(true);
    } catch (e) {
      const key = errorKeyFor(e);
      setError(
        key ? t(`community.errors.${key}`) : (extractErrorDetail(e) ?? t('community.errors.failed')),
      );
    } finally {
      setJoining(false);
    }
  };

  const onSubscribe = async () => {
    if (!code || busy) return;
    setBusy(true);
    setError(null);
    try {
      await subscribe(code);
      setAsked(true);
    } catch (e) {
      const key = errorKeyFor(e);
      if (key === 'unknown_code') setUnresolved(true);
      setError(
        key ? t(`community.errors.${key}`) : (extractErrorDetail(e) ?? t('community.errors.failed')),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!code) {
    return (
      <Sheet title={t('community.invite.badLink')}>
        <Action onClick={() => navigate(ROUTES.spaces)}>{t('community.title')}</Action>
      </Sheet>
    );
  }

  if (handOff) {
    return (
      <Sheet title={t('community.invite.title')} subtitle={formatSpaceCode(code)}>
        <p className="text-sm text-ink-muted">{t('community.invite.handOffBody')}</p>
        <Action
          onClick={() => {
            // A plain assignment, from a real tap: if nothing handles the
            // scheme the page simply stays put, which is the whole reason this
            // is a button.
            window.location.href = appInviteUrl(code);
          }}
        >
          {t('community.invite.openApp')}
        </Action>
        <Action ghost onClick={stayHere}>
          {t('community.invite.continueHere')}
        </Action>
        <Action
          ghost
          onClick={() => {
            void copyText(formatSpaceCode(code)).then((ok) => {
              if (ok) {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }
            });
          }}
        >
          {copied ? '✓' : t('community.invite.copyCode')}
        </Action>
        <p className="text-xs text-ink-muted/70">{t('community.invite.handOffHint')}</p>
      </Sheet>
    );
  }

  // `joining` keeps this screen up for the whole compound action, so the
  // moment the profile exists the user doesn't see the confirm sheet flash past
  // on its way to "asked".
  if (!profile || joining) {
    return (
      <Sheet
        title={t('community.invite.title')}
        subtitle={
          peek ? `${peek.owner.displayName} / ${peek.space.name}` : formatSpaceCode(code)
        }
      >
        <p className="text-sm text-ink-muted">{t('community.invite.needProfile')}</p>
        <input
          value={joinName}
          onChange={(e) => setJoinName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void createProfileAndAsk();
          }}
          placeholder={t('community.profile.displayName') as string}
          maxLength={120}
          autoFocus
          disabled={joining}
          className="w-full bg-surface-raised rounded-xl px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-brand/60 disabled:opacity-60"
        />
        <CommunityTermsConsent checked={joinAgreed} onChange={setJoinAgreed} />
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <Action
          onClick={() => void createProfileAndAsk()}
          disabled={joining || joinName.trim() === '' || !joinAgreed}
        >
          {joining ? t('community.invite.asking') : t('community.invite.createAndAsk')}
        </Action>
        {/* Same disclosure as the other two opt-ins: this is the moment an
            account starts holding shareable data. */}
        <p className="text-xs text-ink-muted/70">{t('community.profile.createHint')}</p>
        <Action ghost onClick={() => navigate(ROUTES.chat)}>
          {t('common.cancel')}
        </Action>
      </Sheet>
    );
  }

  // Same reasoning as the profile state above: the code stays in the URL, so
  // accepting the standards here lands straight back on the invitation.
  if (!termsAccepted) return <CommunityTermsGate />;

  // Your own invitation, opened by you — usually the link you just sent
  // yourself to see what it looks like. Offer the space rather than an "ask to
  // read" button that can only refuse.
  //
  // `isOwnCode` is the store's own test, shared rather than restated: it reads
  // the code's key fingerprint, so it still answers when the *peek* found
  // nothing — a code you have since rotated away, or one minted on another
  // device. Restating it here as "the key the server reported, or the stored
  // shareCode" is what made those codes report as malformed, while the Rooms
  // field refused the same code as your own. The peek's key stays as a first
  // test, since it also covers a code carrying no fingerprint at all.
  const ownSpace =
    (!!peek?.owner.authorKey && peek.owner.authorKey === profile.authorKey) ||
    isOwnCode(code, profile, spaces);
  if (ownSpace) {
    return (
      <Sheet
        title={t('community.invite.ownSpaceTitle')}
        subtitle={peek ? `${peek.owner.displayName} / ${peek.space.name}` : formatSpaceCode(code)}
      >
        <p className="text-sm text-ink-muted">{t('community.errors.own_space')}</p>
        <Action onClick={() => navigate(ROUTES.spaces)}>{t('community.title')}</Action>
        <Action ghost onClick={() => navigate(ROUTES.chat)}>
          {t('common.cancel')}
        </Action>
      </Sheet>
    );
  }

  // Pre-empted rather than left to fail on the button: `peek` carries the
  // author's key, so an invitation from someone this device has blocked can say
  // so instead of offering an action that raises `author_blocked`.
  if (peek?.owner.authorKey && blocked[peek.owner.authorKey]) {
    return (
      <Sheet title={t('community.invite.title')} subtitle={formatSpaceCode(code)}>
        <p className="text-sm text-ink-muted">{t('community.errors.author_blocked')}</p>
        <Action onClick={() => navigate(ROUTES.settings)}>
          {t('community.blockAuthor.title')}
        </Action>
        <Action ghost onClick={() => navigate(ROUTES.chat)}>
          {t('common.cancel')}
        </Action>
      </Sheet>
    );
  }

  if (asked || existing?.status === 'accepted') {
    const accepted = existing?.status === 'accepted';
    return (
      <Sheet
        title={accepted ? t('community.invite.alreadyIn') : t('community.pending')}
        subtitle={peek ? `${peek.owner.displayName} / ${peek.space.name}` : undefined}
      >
        <p className="text-sm text-ink-muted">
          {accepted ? t('community.invite.alreadyInHint') : t('community.invite.askedHint')}
        </p>
        <Action onClick={() => navigate(ROUTES.spaces)}>{t('community.title')}</Action>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={t('community.invite.title')}
      subtitle={peek ? `${peek.owner.displayName} / ${peek.space.name}` : formatSpaceCode(code)}
    >
      {peek?.space.description && (
        <p className="text-sm text-ink-muted">{peek.space.description}</p>
      )}
      {peek?.space.kind === 'today' && (
        <p className="text-xs text-brand-muted">{t('community.todayHint')}</p>
      )}
      <p className="text-sm text-ink-muted">{t('community.invite.confirmBody')}</p>
      {peek?.owner.authorKey && (
        <p className="text-xs text-ink-muted/70">
          {t('community.invite.fingerprint', { fingerprint: keyFingerprint(peek.owner.authorKey) })}
        </p>
      )}
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <Action
        onClick={() => void onSubscribe()}
        disabled={busy || unresolved || (!peek && !error) || !initialized}
      >
        {busy ? t('community.invite.asking') : t('community.invite.ask')}
      </Action>
      <Action ghost onClick={() => navigate(ROUTES.chat)}>
        {t('common.cancel')}
      </Action>
    </Sheet>
  );
}

/** A centred card. Not `BottomSheet`: this is a whole route, arrived at from
 * outside the app, so there is nothing behind it to peek at. */
function Sheet({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    // `m-auto` rather than `items-center justify-center`: centred while it
    // fits, and *scrollable* when it doesn't. Flex centring pushes overflow out
    // of both ends of the scroll box, so the top of a tall sheet — this one now
    // carries the content standards — becomes unreachable. Auto margins
    // collapse to 0 once free space runs out, which is exactly the behaviour
    // wanted here.
    <div className="flex-1 min-h-0 overflow-y-auto flex px-6 py-10">
      <div className="w-full max-w-sm space-y-3 m-auto">
        <h1 className="font-serif text-brand text-2xl">{title}</h1>
        {subtitle && <p className="font-mono text-sm text-ink">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

function Action({
  children,
  onClick,
  ghost = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ghost?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        ghost
          ? 'w-full px-4 py-2.5 rounded-xl text-sm bg-surface-raised text-ink-muted disabled:opacity-40'
          : 'btn-primary w-full py-3 disabled:opacity-40 disabled:cursor-not-allowed'
      }
    >
      {children}
    </button>
  );
}
