/** Uniform random integer in [0, n) using crypto.getRandomValues with
 * rejection sampling to avoid the modulo bias of `% n`. Returns 0 for n <= 1.
 * Used for "random verse" book/chapter/verse selection. */
export function cryptoRandomInt(n: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 0;
  const buf = new Uint32Array(1);
  // rejection sampling — drop values that would bias the modulo
  const limit = Math.floor(0xffffffff / n) * n;
  for (let i = 0; i < 16; i++) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
  // pathological fallback (should never trigger for sane n)
  crypto.getRandomValues(buf);
  return buf[0] % n;
}
