import { useEffect, useState, type RefObject } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

type Props = {
  scrollRef: RefObject<HTMLDivElement | null>;
  threshold?: number;
};

export function ScrollToBottomFab({ scrollRef, threshold = 200 }: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setVisible(distance > threshold);
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef, threshold]);

  if (!visible) return null;

  return (
    <button
      type="button"
      aria-label={t('chat.scrollToBottom')}
      onClick={() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }}
      className={clsx(
        'absolute right-4 bottom-3 z-20',
        'h-10 w-10 rounded-full bg-navy-deep border border-gold/30 text-gold',
        'shadow-lg flex items-center justify-center',
        'hover:bg-navy-soft/80 active:scale-95 transition-all',
      )}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="7 13 12 18 17 13" />
        <polyline points="7 6 12 11 17 6" />
      </svg>
    </button>
  );
}
