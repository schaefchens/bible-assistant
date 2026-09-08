import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { extractErrorDetail } from '@/lib/extractErrorDetail';
import { collectFeedbackContext } from '@/lib/feedbackContext';
import { sendFeedback } from '@/services/api/feedback';
import type { FeedbackKind } from '@/types/domain';

/**
 * Say something about the app: a bug, a feature request, or a remark.
 *
 * A modal rather than a bottom sheet, for `ReportDialog`'s reasons — it is a
 * decision with a submit, and it opens from every screen, where a sheet would
 * sit under the mic dock.
 *
 * The kind is asked *first* and it changes the prompt, because "what's on your
 * mind?" and "what went wrong, and what did you expect?" collect very
 * different text. One box either way: a bug form with a title, steps and an
 * expected-result field collects nothing at all from a tester on a phone.
 */
export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  // The route the user is *reporting about* — this dialog renders over it and
  // navigates nowhere, so the path is still theirs.
  const { pathname } = useLocation();
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [message, setMessage] = useState('');
  const [showContext, setShowContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const text = message.trim();

  const submit = async () => {
    if (busy || !text) return;
    setBusy(true);
    setError(null);
    try {
      await sendFeedback({ kind, message: text, context: collectFeedbackContext(pathname) });
      setDone(true);
    } catch (e) {
      // The text stays in the box: nothing is queued (see services/api/feedback),
      // so retrying is the whole recovery and it must not mean retyping.
      setError(extractErrorDetail(e) ?? t('feedback.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={t('feedback.title') as string}
      // Dismiss by backdrop only while nothing has been written. A mis-tap
      // beside a finished bug report would throw the report away, and there is
      // no draft anywhere to recover it from.
      onClick={() => {
        if (!message) onClose();
      }}
    >
      <div
        className="bg-surface-raised rounded-2xl shadow-2xl border border-surface-raised/70 p-4 w-full max-w-md max-h-[85vh] overflow-y-auto space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <h2 className="text-base font-serif text-brand">{t('feedback.title')}</h2>
          <p className="text-xs text-ink-muted">{t('feedback.intro')}</p>
        </div>

        {done ? (
          <>
            <p className="text-sm text-ink">{t('feedback.sent')}</p>
            <button type="button" onClick={onClose} className="btn-primary w-full">
              {t('common.close')}
            </button>
          </>
        ) : (
          <>
            <SegmentedControl
              cols={3}
              value={kind}
              options={[
                { value: 'bug', label: t('feedback.kinds.bug') },
                { value: 'feature', label: t('feedback.kinds.feature') },
                { value: 'feedback', label: t('feedback.kinds.feedback') },
              ]}
              onChange={(v) => setKind(v)}
            />

            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-ink-muted">
                {t(`feedback.prompts.${kind}`)}
              </span>
              <textarea
                rows={6}
                autoFocus
                value={message}
                maxLength={4000}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t(`feedback.placeholders.${kind}`) as string}
                className="mt-1 w-full bg-surface rounded-xl px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand/60"
              />
            </label>

            {/* What is attached, in full and before sending. It is collected
                rather than asked because none of it can be answered reliably
                from memory — but it is a device fingerprint, so it is shown. */}
            <div className="text-xs">
              <button
                type="button"
                onClick={() => setShowContext((v) => !v)}
                className="text-ink-muted underline decoration-dotted underline-offset-2"
                aria-expanded={showContext}
              >
                {t('feedback.contextToggle')}
              </button>
              {showContext && (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-surface px-3 py-2 font-mono text-[11px] text-ink-muted">
                  {Object.entries(collectFeedbackContext(pathname)).map(([k, v]) => (
                    <div key={k} className="col-span-2 flex gap-3">
                      <dt className="w-20 shrink-0">{k}</dt>
                      <dd className="min-w-0 break-all text-ink">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={onClose} className="btn-ghost text-sm">
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !text}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {t('feedback.submit')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
