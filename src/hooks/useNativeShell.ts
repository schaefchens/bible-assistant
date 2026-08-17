import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { useGlobalVoiceStore } from '@/store/globalVoiceStore';
import { audioPlayback } from '@/lib/audioPlaybackManager';

/**
 * Native-shell behaviours that have no browser equivalent. All no-ops on web,
 * so AppShell can mount this unconditionally.
 *
 *   1. Android hardware Back — without a handler it quits the app from any
 *      screen, which is strictly worse than the browser's behaviour.
 *   2. Foreground resume — a native app resumes without re-booting, so the
 *      boot-time teardown in useAppInitialization never runs again. iOS may
 *      have suspended the AudioContext while backgrounded.
 *   3. Keyboard chrome — the iOS accessory ("Done") bar and the WebView's own
 *      scroll-on-focus both fight the app's self-scrolling panes.
 */
export function useNativeShell(): void {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const cleanups: Array<() => void> = [];

    // 1. Back button: dismiss the full-screen overlay first, then walk
    // history, then exit. Matches what the hardware key means on Android.
    void App.addListener('backButton', ({ canGoBack }) => {
      const voice = useGlobalVoiceStore.getState();
      if (voice.eyesFreeMode) {
        voice.setEyesFreeMode(false);
      } else if (canGoBack) {
        window.history.back();
      } else {
        void App.exitApp();
      }
    }).then((h) => cleanups.push(() => void h.remove()));

    // 2. Resuming from the background: iOS suspends the AudioContext, and a
    // ramp scheduled against a suspended clock never completes. Nudging it
    // here means the next play doesn't need a fresh user gesture.
    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      const ctx = audioPlayback.getContext();
      if (ctx?.state === 'suspended') void ctx.resume().catch(() => {});
    }).then((h) => cleanups.push(() => void h.remove()));

    // 3. Keyboard chrome. Both of these are iOS-only — on Android they reject
    // with UNIMPLEMENTED and Capacitor logs a bridge error, so gate rather
    // than swallow. Android gets the equivalent from windowSoftInputMode
    // (adjustResize) in the manifest.
    if (Capacitor.getPlatform() === 'ios') {
      void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
      void Keyboard.setScroll({ isDisabled: true }).catch(() => {});
    }

    return () => {
      for (const fn of cleanups) fn();
    };
  }, []);
}
