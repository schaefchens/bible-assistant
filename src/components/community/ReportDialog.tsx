import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorDetail } from '@/lib/extractErrorDetail';
import { useCommunityStore } from '@/store/communityStore';
import { REPORT_REASONS, type ReportReason } from '@/types/domain';

/**
 * Report a piece, or a whole space, to the moderators.
 *
 * A modal rather than a sheet because it is a decision with a submit, and
 * because it is opened from the reader — where a bottom sheet would sit under
 * the mic dock. Same overlay shape as `AddCardsModal`.
 *
 * The reasons are the accepted content standards restated as choices: a report
 * form whose options don't line up with the rules produces reports a moderator
 * can't act on. A free-text note is optional and capped server-side.
 */
export function ReportDialog({
  code,
  postId,
  title,
  onClose,
}: {
  /** The space's share code — the only way to name a space to the server. */
  code: string;
  /** Omit to report the space itself rather than one piece. */
  postId?: string;
  /** What is being reported, shown so nobody reports the wrong thing. */
  title: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const report = useCommunityStore((s) => s.reportContent);
  const reported = useCommunityStore((s) => s.reported);
  const [reason, setReason] = useState<ReportReason>('offtopic');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const already = Boolean(reported[postId ?? code]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await report({ code, postId, reason, note: note.trim() || undefined });
      setDone(true);
    } catch (e) {
      setError(extractErrorDetail(e) ?? t('community.report.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={t('community.report.title') as string}
      onClick={onClose}
    >
      <div
        className="bg-surface-raised rounded-2xl shadow-2xl border border-surface-raised/70 p-4 w-full max-w-md max-h-[85vh] overflow-y-auto space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <h2 className="text-base font-serif text-brand">{t('community.report.title')}</h2>
          <p className="text-xs text-ink-muted truncate">{title}</p>
        </div>

        {done ? (
          <>
            <p className="text-sm text-ink">{t('community.report.sent')}</p>
            <button type="button" onClick={onClose} className="btn-primary w-full">
              {t('common.close')}
            </button>
          </>
        ) : (
          <>
            {already && <p className="text-xs text-brand-muted">{t('community.report.already')}</p>}

            <fieldset className="space-y-1.5">
              <legend className="text-[11px] uppercase tracking-wider text-ink-muted mb-1">
                {t('community.report.reasonLabel')}
              </legend>
              {REPORT_REASONS.map((r) => (
                <label
                  key={r}
                  className="flex items-center gap-2.5 text-sm text-ink cursor-pointer rounded-lg px-2 py-1.5 hover:bg-surface"
                >
                  <input
                    type="radio"
                    name="report-reason"
                    checked={reason === r}
                    onChange={() => setReason(r)}
                    className="h-4 w-4 shrink-0 accent-[rgb(var(--brand))]"
                  />
                  <span>{t(`community.report.reasons.${r}`)}</span>
                </label>
              ))}
            </fieldset>

            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-ink-muted">
                {t('community.report.noteLabel')}
              </span>
              <textarea
                rows={3}
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('community.report.notePlaceholder') as string}
                className="mt-1 w-full bg-surface rounded-xl px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand/60"
              />
            </label>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={onClose} className="btn-ghost text-sm">
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {t('community.report.submit')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
