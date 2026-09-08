import { useTranslation } from 'react-i18next';

/**
 * The community's content standards, as read at the moment of accepting them.
 *
 * One component for all three places they appear — the two opt-in surfaces and
 * the gate for people who enabled the community before the standards existed —
 * because a rule worded differently in one of them is a rule nobody can be
 * held to. `COMMUNITY_TERMS_VERSION` in `lib/communityTerms.ts` is what the
 * acceptance is recorded against.
 *
 * Presentational only: it neither reads nor writes the acceptance.
 */
export function CommunityTerms({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <p className="text-sm text-ink-muted">{t('community.terms.intro')}</p>
      <ul className="space-y-1.5 text-sm text-ink">
        {(['rule1', 'rule2', 'rule3', 'rule4', 'rule5'] as const).map((k) => (
          <li key={k} className="flex gap-2">
            <span aria-hidden className="text-brand shrink-0">
              ·
            </span>
            <span>{t(`community.terms.${k}`)}</span>
          </li>
        ))}
      </ul>
      {/* Kept visually distinct from the rules: it is the one line that says
          what happens to the user, not what is asked of them. */}
      <p className="text-xs text-ink-muted border-l-2 border-brand/40 pl-3">
        {t('community.terms.moderation')}
      </p>
      <p className="text-xs text-ink-muted/80">{t('community.terms.tools')}</p>
    </div>
  );
}

/**
 * The standards plus the checkbox that gates a "create" button. The caller owns
 * the state, because it also owns the button the checkbox is gating.
 */
export function CommunityTermsConsent({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <CommunityTerms compact />
      <label className="flex items-start gap-2.5 text-sm text-ink cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]"
        />
        <span>{t('community.terms.accept')}</span>
      </label>
    </div>
  );
}
