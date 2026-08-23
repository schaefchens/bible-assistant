import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useChatStore } from '@/store/chatStore';
import { useCommandPipeline } from '@/hooks/useCommandPipeline';
import {
  RIBBON_COLORS,
  useRibbonsStore,
  type Ribbon,
  type RibbonColor,
} from '@/store/ribbonsStore';
import { getBookById } from '@/services/bible/bookCatalog';
import { audioPlayback } from '@/lib/audioPlaybackManager';

// Static class lookup so Tailwind's JIT keeps every ribbon color in the build.
const RIBBON_CLASSES: Record<
  RibbonColor,
  { border: string; fill: string; tint: string }
> = {
  gold: {
    border: 'border-ribbon-gold/50',
    fill: 'text-ribbon-gold',
    tint: 'hover:bg-ribbon-gold/10 active:bg-ribbon-gold/15',
  },
  blue: {
    border: 'border-ribbon-blue/50',
    fill: 'text-ribbon-blue',
    tint: 'hover:bg-ribbon-blue/10 active:bg-ribbon-blue/15',
  },
  red: {
    border: 'border-ribbon-red/50',
    fill: 'text-ribbon-red',
    tint: 'hover:bg-ribbon-red/10 active:bg-ribbon-red/15',
  },
  green: {
    border: 'border-ribbon-green/50',
    fill: 'text-ribbon-green',
    tint: 'hover:bg-ribbon-green/10 active:bg-ribbon-green/15',
  },
  purple: {
    border: 'border-ribbon-purple/50',
    fill: 'text-ribbon-purple',
    tint: 'hover:bg-ribbon-purple/10 active:bg-ribbon-purple/15',
  },
};

export function RibbonBar() {
  const { t, i18n } = useTranslation();
  const slots = useRibbonsStore((s) => s.slots);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const { send } = useCommandPipeline();

  const set = RIBBON_COLORS.filter((c): c is RibbonColor => slots[c] !== null);
  if (set.length === 0) return null;

  const lang: 'en' | 'de' = (i18n.language || 'en').startsWith('de') ? 'de' : 'en';

  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar px-3 py-1.5 border-b border-surface-raised/40 bg-surface/60">
      {set.map((color) => {
        const r = slots[color] as Ribbon;
        const cls = RIBBON_CLASSES[color];
        return (
          <button
            key={color}
            type="button"
            disabled={isProcessing}
            onClick={() => {
              audioPlayback.ensureContext();
              void send(`Continue from ${color} ribbon`);
            }}
            aria-label={t('chat.ribbon.resume', { color })}
            className={clsx(
              'shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
              'text-ink transition-colors active:scale-95',
              'disabled:opacity-40 disabled:pointer-events-none',
              cls.border,
              cls.tint,
            )}
          >
            <RibbonIcon className={clsx('shrink-0', cls.fill)} />
            <span className="font-mono tabular-nums">{formatRef(r, lang)}</span>
          </button>
        );
      })}
    </div>
  );
}

function formatRef(r: Ribbon, lang: 'en' | 'de'): string {
  const book = getBookById(r.bookId);
  const name = book ? (lang === 'de' ? book.nameDe : book.nameEn) : `?${r.bookId}`;
  return `${abbreviate(name)} ${r.chapter}:${r.verse}`;
}

function abbreviate(name: string): string {
  // "1 John" / "1. Mose" → keep digit prefix, abbreviate the word after.
  const m = name.match(/^(\d\.?)\s+(.+)$/);
  if (m) return `${m[1]} ${m[2].slice(0, 3)}`;
  return name.slice(0, 3);
}

function RibbonIcon({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="14"
      viewBox="0 0 12 14"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M1 1.5A0.5 0.5 0 0 1 1.5 1h9a0.5 0.5 0 0 1 0.5 0.5V13l-5-3-5 3V1.5z" />
    </svg>
  );
}
