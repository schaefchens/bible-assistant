import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { deleteAccount } from '@/services/api/auth';
import { extractErrorDetail } from '@/lib/extractErrorDetail';

/**
 * Settings tile for the server-sync opt-in.
 *
 * Sync is off on a fresh install and the server holds nothing until it's
 * switched on — api.php creates the account lazily, on the first write. So this
 * toggle is the moment an account comes into existence, and the copy says so
 * rather than treating the server as a given.
 */
export function SyncSection() {
  const { t } = useTranslation();
  const syncEnabled = useSettingsStore((s) => s.syncEnabled);
  const enableSync = useLibraryStore((s) => s.enableSync);
  const disableSync = useLibraryStore((s) => s.disableSync);
  const pendingOps = useLibraryStore((s) => s.pendingOps);
  const online = useLibraryStore((s) => s.online);

  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same two-tap-with-timeout idiom as DangerZone and PackActionButton.
  useEffect(() => {
    if (!confirmingDelete) return;
    const id = window.setTimeout(() => setConfirmingDelete(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirmingDelete]);

  const onToggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDeleted(false);
    try {
      if (next) await enableSync();
      else await disableSync();
    } catch (e) {
      setError(extractErrorDetail(e) ?? t('settings.sync.failed'));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (deleting) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount();
      // Deleting the server copy while still syncing would just re-upload it
      // on the next flush, so switching off is part of the same action.
      await disableSync();
      setDeleted(true);
    } catch (e) {
      setError(extractErrorDetail(e) ?? t('settings.sync.failed'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-3 cursor-pointer">
        <span className="text-sm">{t('settings.sync.toggle')}</span>
        <input
          type="checkbox"
          checked={syncEnabled}
          disabled={busy}
          onChange={(e) => void onToggle(e.target.checked)}
        />
      </label>

      <p className="text-xs text-cream-dim">
        {syncEnabled ? t('settings.sync.onHint') : t('settings.sync.offHint')}
      </p>

      {busy && <p className="text-xs text-gold">{t('settings.sync.working')}</p>}

      {syncEnabled && !busy && (
        <>
          <p className="text-xs text-gold-dim">{t('settings.sync.writeDown')}</p>
          {pendingOps > 0 && (
            <p className="text-xs text-amber-400">
              {online
                ? t('common.pending', { count: pendingOps })
                : t('settings.sync.pendingOffline', { count: pendingOps })}
            </p>
          )}
        </>
      )}

      {deleted && <p className="text-xs text-gold">{t('settings.sync.deleted')}</p>}
      {error && <p className="text-xs text-rose-400">{error}</p>}

      <div className="pt-1">
        <p className="text-xs text-cream-dim mb-2">{t('settings.sync.deleteHint')}</p>
        <button
          type="button"
          onClick={() => void onDelete()}
          disabled={deleting || busy}
          className="text-sm text-red-400 hover:bg-red-500/10 border border-red-500/40 rounded-xl px-3 py-2 transition-colors disabled:opacity-60"
        >
          {deleting
            ? t('settings.sync.deleting')
            : confirmingDelete
              ? t('settings.sync.deleteConfirm')
              : t('settings.sync.delete')}
        </button>
      </div>
    </div>
  );
}
