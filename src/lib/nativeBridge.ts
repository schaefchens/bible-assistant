/**
 * Thin wrappers over the three browser APIs that don't work (or don't exist)
 * inside a native WebView, each falling back to the web behaviour.
 *
 *   - navigator.vibrate  — a no-op on iOS Safari *and* in WKWebView, so the
 *     eyes-free UI's haptics have never fired on the platform that needs them
 *     most. @capacitor/haptics drives the Taptic Engine directly.
 *   - navigator.share    — absent in both WebViews; ReaderPanel silently fell
 *     back to a clipboard copy.
 *   - navigator.clipboard — works under capacitor:// (a secure context), but
 *     the native plugin is more reliable, and copying the recovery mnemonic is
 *     the highest-stakes copy in the app.
 *
 * Everything here is best-effort: a failed haptic or share must never break
 * the interaction it decorates.
 */
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Share } from '@capacitor/share';
import { Clipboard } from '@capacitor/clipboard';

const isNative = (): boolean => Capacitor.isNativePlatform();

/** Short tap — button presses, drag snap, zone entry. */
export function hapticTap(style: ImpactStyle = ImpactStyle.Light): void {
  if (isNative()) {
    void Haptics.impact({ style }).catch(() => {});
    return;
  }
  navigator.vibrate?.(8);
}

/** Heavier confirmation — long-press engaged, action committed. */
export function hapticNotify(): void {
  if (isNative()) {
    void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
    return;
  }
  navigator.vibrate?.([20, 35, 20]);
}

/** Copy text. Resolves false when nothing could be copied. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (isNative()) {
      await Clipboard.write({ string: text });
      return true;
    }
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Share text via the OS sheet, falling back to a clipboard copy. */
export async function shareText(text: string): Promise<void> {
  try {
    if (isNative()) {
      await Share.share({ text });
      return;
    }
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
  } catch {
    // User dismissed the sheet, or sharing is unavailable — fall through to
    // the copy so the gesture still does something useful.
  }
  await copyText(text);
}

export { ImpactStyle };
