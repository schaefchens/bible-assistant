import { useTranslation } from 'react-i18next';
import {
  closeInstallCard,
  installPlatform,
  promptInstall,
  useInstallStore,
} from '@/lib/pwaInstall';

/**
 * The `?install=1` card: one button that opens the browser's real install
 * dialog, or — where there is no install API — written instructions for that
 * browser.
 *
 * A modal in the app's existing shape (`ReportDialog`, `FeedbackDialog`,
 * `AddCardsModal`) rather than a bottom sheet, for their reasons: it is a
 * decision with a button, and a sheet would sit under the mic dock.
 *
 * **Mounted above the router, not inside `AppShell`.** A visitor arriving from
 * a QR code or a flyer is by definition a first-time visitor, and `AppShell`
 * renders `OnboardingWizard` *instead of* its whole tree until onboarding is
 * done — so a card mounted in the shell would be invisible to this feature's
 * entire audience. The scrim covers the wizard, which is the only other thing
 * in this app that appears without being tapped.
 *
 * `z-[2100]` for one concrete reason: `?install=1` can be appended to any URL,
 * `/cards` included, where `LibraryTabs` is `z-[1000]` and a carried card is
 * 2000. Every fixed overlay in the app is at 60 or below, so those two are what
 * this has to clear.
 */
export function InstallPrompt() {
  const { t } = useTranslation();
  // Primitives, selected one at a time: a selector returning an object would
  // hand back a new reference on every store write.
  const open = useInstallStore((s) => s.open);
  const promptable = useInstallStore((s) => s.promptable);
  const timedOut = useInstallStore((s) => s.timedOut);
  const installed = useInstallStore((s) => s.installed);

  if (!open) return null;
  // Still inside the wait for a `beforeinstallprompt`. Nothing is drawn rather
  // than a spinner: in Chrome the event is usually already parked and the card
  // is immediate, and everywhere else a placeholder would only flash on its way
  // to the instructions.
  if (!installed && !promptable && !timedOut) return null;

  return (
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={t('install.title') as string}
      onClick={closeInstallCard}
    >
      <div
        className="bg-surface-raised rounded-2xl shadow-2xl border border-surface-raised/70 p-4 w-full max-w-sm max-h-[85vh] overflow-y-auto space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        {installed ? (
          <>
            <h2 className="text-base font-serif text-brand">{t('install.done.title')}</h2>
            <p className="text-sm text-ink">{t('install.done.body')}</p>
            <button type="button" onClick={closeInstallCard} className="btn-primary w-full">
              {t('common.close')}
            </button>
          </>
        ) : (
          <>
            <h2 className="text-base font-serif text-brand">{t('install.title')}</h2>
            <p className="text-sm text-ink-muted">{t('install.intro')}</p>

            {promptable ? (
              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={closeInstallCard} className="btn-ghost text-sm">
                  {t('install.notNow')}
                </button>
                {/* Nothing is awaited between this click and `prompt()` — see
                    promptInstall(). `void` rather than `await`: the handler
                    must not be async, or the gesture is gone before the call. */}
                <button
                  type="button"
                  autoFocus
                  onClick={() => void promptInstall()}
                  className="btn-primary text-sm"
                >
                  {t('install.action')}
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-ink">{t(`install.steps.${installPlatform()}`)}</p>
                <button type="button" onClick={closeInstallCard} className="btn-ghost w-full text-sm">
                  {t('common.close')}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
