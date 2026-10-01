/**
 * Downscale a picked image before uploading it.
 *
 * The app had no image handling at all before profiles, so this is deliberately
 * the whole of it: one function, canvas only, no dependency.
 *
 * Resizing on the device rather than the server is what keeps the upload path
 * simple and cheap — api.php caps avatars at 512 KB and validates the type by
 * reading the bytes, but it does not (and with no guaranteed GD extension,
 * cannot reliably) re-encode. A 12 MP phone photo would just be rejected.
 */

/** Avatars are shown at 40–96 px; 512 covers a retina profile card. */
const MAX_EDGE = 512;
const JPEG_QUALITY = 0.85;

type ResizedImage = { blob: Blob; filename: string };

/**
 * Fit `file` inside a `maxEdge` square, centre-cropped to a square, as JPEG.
 *
 * Square-cropped rather than letterboxed because every place an avatar appears
 * is a circle or a square, and cropping here means the UI never has to.
 */
export async function resizeAvatar(file: Blob, maxEdge = MAX_EDGE): Promise<ResizedImage> {
  const canvas = await squareCanvas(file, maxEdge);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new Error('could not encode image');
  return { blob, filename: 'avatar.jpg' };
}

/** Qualities tried, best first, until an inline avatar fits its budget. */
const INLINE_QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45];

/**
 * An avatar as a `data:` URL no longer than `maxChars` — for the one picture
 * that travels *inside* a record rather than being uploaded: a narration
 * voice's, which syncs with the voice and must work offline (see
 * services/voices/voiceProfiles.ts). Small on purpose: 256 px covers a 96 px
 * circle on a 3× screen, and quality steps down until it fits.
 */
export async function avatarDataUrl(file: Blob, maxEdge: number, maxChars: number): Promise<string> {
  const canvas = await squareCanvas(file, maxEdge);
  for (const q of INLINE_QUALITIES) {
    const url = canvas.toDataURL('image/jpeg', q);
    if (url.length <= maxChars) return url;
  }
  throw new Error('image too large');
}

async function squareCanvas(file: Blob, maxEdge: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  try {
    const edge = Math.min(bitmap.width, bitmap.height);
    const size = Math.min(edge, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    // Centre crop: take the largest square from the middle of the source.
    ctx.drawImage(
      bitmap,
      (bitmap.width - edge) / 2,
      (bitmap.height - edge) / 2,
      edge,
      edge,
      0,
      0,
      size,
      size,
    );
    return canvas;
  } finally {
    // Frees the decoded pixels immediately rather than at the next GC — these
    // are tens of megabytes for a phone photo.
    bitmap.close();
  }
}
