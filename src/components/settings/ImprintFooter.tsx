import { useEffect, useRef, useState } from 'react';

/** German legal imprint (§ 5 TMG), hidden behind a 3-second long-press easter
 * egg (a sheep appears at 1s as press feedback). */
export function ImprintFooter() {
  const [revealed, setRevealed] = useState(false);
  const [sheep, setSheep] = useState(false);
  const sheepTimer = useRef<number | null>(null);
  const revealTimer = useRef<number | null>(null);

  const clearTimers = () => {
    if (sheepTimer.current !== null) {
      window.clearTimeout(sheepTimer.current);
      sheepTimer.current = null;
    }
    if (revealTimer.current !== null) {
      window.clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
  };

  // Sheep at 1s as visual confirmation that the long-press is registering;
  // reveal at 3s. Releasing early aborts both. § 5 TMG still calls for
  // imprint disclosure, but a Diener des Herrn doesn't make it easy ;)
  const onPressStart = () => {
    if (revealed) return;
    clearTimers();
    sheepTimer.current = window.setTimeout(() => setSheep(true), 1000);
    revealTimer.current = window.setTimeout(() => {
      setRevealed(true);
      setSheep(false);
    }, 3000);
  };

  const onPressEnd = () => {
    clearTimers();
    setSheep(false);
  };

  useEffect(() => () => clearTimers(), []);

  return (
    <section className="mt-10 pt-6 border-t border-navy-soft/50 text-center text-xs text-cream-dim">
      <h3 className="font-serif text-gold/80 text-sm tracking-wide">
        Impressum
      </h3>
      <p className="text-[10px] uppercase tracking-widest text-cream-dim/70 mt-0.5">
        gemäß § 5 TMG
      </p>

      <div className="mt-4 mx-auto max-w-xs rounded-2xl border border-navy-soft/60 bg-navy-soft/30 px-5 py-4 space-y-2">
        <p className="text-cream-dim/80">Gemacht von:</p>
        {revealed ? (
          <address className="not-italic leading-relaxed text-cream">
            Christoph Scharf
            <br />
            Mühltorstr. 1
            <br />
            67245 Lambsheim
            <br />
            <a
              href="mailto:christoph.scharf+bibleassistant@scharfmedia.de"
              className="text-gold hover:text-gold/80 break-all"
            >
              christoph.scharf+bibleassistant@scharfmedia.de
            </a>
          </address>
        ) : (
          <>
            <button
              type="button"
              onPointerDown={onPressStart}
              onPointerUp={onPressEnd}
              onPointerLeave={onPressEnd}
              onPointerCancel={onPressEnd}
              onContextMenu={(e) => e.preventDefault()}
              className="text-cream underline decoration-dotted underline-offset-4 hover:text-gold transition-colors select-none"
              style={{ WebkitTouchCallout: 'none' }}
            >
              einem Diener des Herrn
            </button>
            {sheep && (
              <div
                aria-hidden="true"
                className="text-6xl leading-none mt-2 select-none pointer-events-none"
              >
                🐑
              </div>
            )}
          </>
        )}
        <p className="pt-2 italic text-cream-dim/80 font-serif">
          „Mit der Gnade Gottes und Claude"
        </p>
      </div>
    </section>
  );
}
