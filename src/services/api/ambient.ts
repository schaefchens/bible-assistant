import { apiGetJson } from './client';

export type AmbientTrack = { id: string; title: string; url: string };

let cache: Promise<AmbientTrack[]> | null = null;

export function getAmbientTracks(): Promise<AmbientTrack[]> {
  if (!cache) {
    cache = apiGetJson<{ tracks: AmbientTrack[] }>('ambient.list')
      .then((r) => r.tracks ?? [])
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
