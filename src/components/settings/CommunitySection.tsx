import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { extractErrorDetail } from '@/lib/extractErrorDetail';
import { resizeAvatar } from '@/lib/imageResize';
import { keyFingerprint } from '@/lib/spaceCode';
import { ROUTES } from '@/lib/appRoutes';
import { useCommunityStore } from '@/store/communityStore';
import { useSettingsStore } from '@/store/settingsStore';
import { COMMUNITY_TERMS_VERSION } from '@/lib/communityTerms';
import { CommunityTerms, CommunityTermsConsent } from '@/components/community/CommunityTerms';

/**
 * Settings tile for the community profile.
 *
 * The profile is the single opt-in for the whole feature: publishing and
 * subscribing both need it, and creating it turns on server sync, because
 * sharing is inherently server-side and a second switch would only be a second
 * thing to explain.
 *
 * Leaving is the counterpart and the copy has to be exact about it: it removes
 * the profile and the shared copies from the server and **keeps the user's
 * writing on the device**. Only a factory reset removes that.
 */
export function CommunitySection() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const profile = useCommunityStore((s) => s.profile);
  const busy = useCommunityStore((s) => s.busy);
  const memberships = useCommunityStore((s) => s.memberships);
  const enableCommunity = useCommunityStore((s) => s.enableCommunity);
  const disableCommunity = useCommunityStore((s) => s.disableCommunity);
  const saveProfile = useCommunityStore((s) => s.saveProfile);
  const setAvatar = useCommunityStore((s) => s.setAvatar);
  const blocked = useCommunityStore((s) => s.blocked);
  const unblockAuthor = useCommunityStore((s) => s.unblockAuthor);
  const acceptTerms = useSettingsStore((s) => s.acceptCommunityTerms);

  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Same two-tap-with-timeout idiom as SyncSection and DangerZone.
  useEffect(() => {
    if (!confirmingLeave) return;
    const id = window.setTimeout(() => setConfirmingLeave(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirmingLeave]);

  const pending = memberships.filter((m) => m.status === 'pending').length;
  const fingerprint = profile?.authorKey ? keyFingerprint(profile.authorKey) : null;

  const onCreate = async () => {
    const displayName = name.trim();
    if (!displayName || !agreed || busy) return;
    setError(null);
    try {
      acceptTerms(COMMUNITY_TERMS_VERSION);
      await enableCommunity(displayName);
    } catch (e) {
      setError(extractErrorDetail(e) ?? t('community.errors.failed'));
    }
  };

  const onPickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const { blob, filename } = await resizeAvatar(file);
      await setAvatar(blob, filename);
    } catch (e) {
      setError(extractErrorDetail(e) ?? t('community.errors.failed'));
    }
  };

  const onLeave = async () => {
    if (busy) return;
    if (!confirmingLeave) {
      setConfirmingLeave(true);
      return;
    }
    setConfirmingLeave(false);
    setError(null);
    try {
      await disableCommunity();
    } catch (e) {
      setError(extractErrorDetail(e) ?? t('community.errors.failed'));
    }
  };

  if (!profile) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-ink-muted">{t('community.profile.hint')}</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('community.profile.displayName') as string}
          maxLength={120}
          className="w-full bg-surface-raised rounded-xl px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-brand/60"
        />
        <CommunityTermsConsent checked={agreed} onChange={setAgreed} />
        <button
          type="button"
          onClick={() => void onCreate()}
          disabled={busy || !agreed || name.trim() === ''}
          className="btn-primary w-full disabled:opacity-50"
        >
          {t('community.profile.create')}
        </button>
        {/* Stated up front, not discovered afterwards: this is the moment an
            account starts holding shareable data. */}
        <p className="text-xs text-ink-muted">{t('community.profile.createHint')}</p>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label={t('community.profile.avatarChange') as string}
          className="h-14 w-14 rounded-full overflow-hidden bg-surface-raised flex items-center justify-center text-brand shrink-0"
        >
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-lg font-serif">
              {profile.displayName.slice(0, 1).toUpperCase() || '?'}
            </span>
          )}
        </button>
        {/* accept without `capture` opens the system photo picker on both
            platforms, which needs no camera permission in Info.plist or the
            Android manifest. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void onPickAvatar(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <div className="min-w-0 flex-1">
          <DraftField
            value={profile.displayName}
            onCommit={(v) => void saveProfile({ displayName: v })}
            placeholder={t('community.profile.displayName') as string}
            maxLength={120}
          />
        </div>
      </div>

      <DraftField
        value={profile.bio ?? ''}
        onCommit={(v) => void saveProfile({ bio: v || undefined })}
        placeholder={t('community.profile.bio') as string}
        maxLength={500}
        multiline
      />

      <button
        type="button"
        onClick={() => navigate(ROUTES.spaces)}
        className="w-full text-left px-3 py-2 rounded-xl bg-surface-raised flex items-center justify-between"
      >
        <span className="text-sm text-ink">{t('community.title')}</span>
        <span className="text-xs text-brand">
          {pending > 0 ? t('community.requests', { count: pending }) : '›'}
        </span>
      </button>

      {fingerprint && (
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-muted">
            {t('community.profile.fingerprint')}
          </p>
          <p className="font-mono text-sm text-brand">{fingerprint}</p>
          <p className="text-xs text-ink-muted mt-1">
            {t('community.profile.fingerprintHint')}
          </p>
        </div>
      )}

      {/* Readable after acceptance too: a policy you agreed to once and can
          never see again is not a policy. */}
      <button
        type="button"
        onClick={() => setTermsOpen((v) => !v)}
        aria-expanded={termsOpen}
        className="w-full text-left px-3 py-2 rounded-xl bg-surface-raised flex items-center justify-between"
      >
        <span className="text-sm text-ink">{t('community.terms.view')}</span>
        <span className="text-xs text-brand">{termsOpen ? '⌃' : '›'}</span>
      </button>
      {termsOpen && (
        <div className="px-3">
          <CommunityTerms compact />
        </div>
      )}

      {Object.keys(blocked).length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-ink-muted">
            {t('community.blockAuthor.title')}
          </p>
          {Object.values(blocked).map((b) => (
            <div
              key={b.authorKey}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-raised"
            >
              <span className="min-w-0 flex-1 text-sm text-ink truncate">
                {b.displayName || b.authorKey.slice(0, 12)}
              </span>
              <button
                type="button"
                onClick={() => void unblockAuthor(b.authorKey)}
                className="text-[11px] text-brand hover:underline shrink-0"
              >
                {t('community.blockAuthor.unblock')}
              </button>
            </div>
          ))}
          <p className="text-xs text-ink-muted">{t('community.blockAuthor.sectionHint')}</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => void onLeave()}
        disabled={busy}
        className={clsx(
          'w-full px-3 py-2 rounded-xl text-sm transition-colors disabled:opacity-50',
          confirmingLeave ? 'bg-red-500/15 text-red-400' : 'bg-surface-raised text-ink-muted',
        )}
      >
        {busy
          ? t('community.profile.leaving')
          : confirmingLeave
            ? t('community.profile.leaveConfirm')
            : t('community.profile.leave')}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

/**
 * A field that commits on blur or Enter rather than per keystroke.
 *
 * Same reasoning as `ReadingListDetail`'s DraftInput: `saveProfile` awaits a
 * Dexie write and queues a sync op, so a controlled input bound straight to
 * store state drops characters and queues one op per letter typed. Outside
 * changes are adopted during render while unfocused — not in an effect, because
 * `set-state-in-effect` is an error in this codebase.
 */
function DraftField({
  value,
  onCommit,
  placeholder,
  maxLength,
  multiline = false,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder: string;
  maxLength: number;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [adopted, setAdopted] = useState(value);
  if (!focused && value !== adopted) {
    setAdopted(value);
    setDraft(value);
  }

  const commit = () => {
    setFocused(false);
    const next = draft.trim();
    if (next !== value) onCommit(next);
  };

  const cls =
    'w-full bg-surface-raised rounded-xl px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-brand/60';

  if (multiline) {
    return (
      <textarea
        rows={2}
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className={cls}
      />
    );
  }
  return (
    <input
      value={draft}
      maxLength={maxLength}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className={cls}
    />
  );
}
