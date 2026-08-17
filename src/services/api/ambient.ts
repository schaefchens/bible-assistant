import { apiGetJson } from './client';
import { serverUrl } from './origin';

export type AmbientTrack = { id: string; title: string; url: string };

let cache: Promise<AmbientTrack[]> | null = null;

export function getAmbientTracks(): Promise<AmbientTrack[]> {
  if (!cache) {
    cache = apiGetJson<{ tracks: AmbientTrack[] }>('ambient.list')
      // Root-relative from the server; absolutized here so ambientAudioBus can
      // fetch it unchanged from the native WebView. No-op on the web build.
      .then((r) => (r.tracks ?? []).map((t) => ({ ...t, url: serverUrl(t.url) })))
      .catch((e) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}

export async function getAmbientTrackUrl(id: string): Promise<string | null> {
  const tracks = await getAmbientTracks();
  return tracks.find((t) => t.id === id)?.url ?? null;
}
