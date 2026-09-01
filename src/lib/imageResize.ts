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

export type ResizedImage = { blob: Blob; filename: string };

/**
 * Fit `file` inside a MAX_EDGE square, centre-cropped to a square, as JPEG.
 *
 * Square-cropped rather than letterboxed because every place an avatar appears
 * is a circle or a square, and cropping here means the UI never has to.
 */
export async function resizeAvatar(file: Blob): Promise<ResizedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const edge = Math.min(bitmap.width, bitmap.height);
    const size = Math.min(edge, MAX_EDGE);
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
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) throw new Error('could not encode image');
    return { blob, filename: 'avatar.jpg' };
  } finally {
    // Frees the decoded pixels immediately rather than at the next GC — these
    // are tens of megabytes for a phone photo.
    bitmap.close();
  }
}
