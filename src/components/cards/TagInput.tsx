import { useMemo, useRef, useState } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { normalizeTag } from '@/utils/tagUtils';

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
};

export function TagInput({ value, onChange, placeholder }: Props) {
  const allCards = useLibraryStore((s) => s.cards);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of allCards) for (const t of c.tags ?? []) set.add(t);
    return Array.from(set).sort();
  }, [allCards]);

  const suggestions = useMemo(() => {
    const norm = normalizeTag(draft);
    if (!focused) return [];
    return allTags
      .filter((t) => !value.includes(t) && (norm === '' || t.includes(norm)))
      .slice(0, 8);
  }, [allTags, draft, focused, value]);

  const commit = (raw: string) => {
    const tag = normalizeTag(raw);
    if (!tag) return;
    if (value.includes(tag)) {
      setDraft('');
      return;
    }
    onChange([...value, tag]);
    setDraft('');
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  return (
    <div className="relative">
      <div
        className="flex flex-wrap items-center gap-1.5 bg-surface-raised rounded-xl px-2 py-2 min-h-[2.75rem] cursor-text focus-within:ring-2 focus-within:ring-brand/60"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 bg-brand/20 text-ink rounded-full pl-2 pr-1 py-0.5 text-xs"
          >
            #{tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(tag);
              }}
              className="rounded-full w-4 h-4 inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-black/20"
              aria-label={`Remove ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
              if (draft.trim()) {
                e.preventDefault();
                commit(draft);
              }
            } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
              remove(value[value.length - 1]);
            }
          }}
          placeholder={value.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[6rem] bg-transparent outline-none text-ink text-sm py-1"
        />
      </div>
      {focused && suggestions.length > 0 && (
        <div className="absolute z-10 mt-1 left-0 right-0 bg-surface-raised rounded-xl shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                commit(s);
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-ink hover:bg-surface"
            >
              #{s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
