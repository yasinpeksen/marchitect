'use client';
import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { useData } from '@/lib/api';

/** Splits typed/pasted text into normalised tags (lowercase, collapsed whitespace) and merges them into `existing`, capped at `maximum`. */
export function mergeTags(existing: string[], rawText: string, maximum = 20): string[] {
  const additions = rawText
    .split(/[,\n]/)
    .map((piece) => piece.replaceAll(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean);
  if (additions.length === 0) return existing;
  return [...new Set([...existing, ...additions])].slice(0, maximum);
}

/** Multi-keyword input: Enter / comma adds a tag, Backspace removes the last, pasted lists are split. */
export function TagInput({
  tags, onChange, large, placeholder = 'Type a keyword and press Enter…', max = 20,
}: { tags: string[]; onChange: (tags: string[]) => void; large?: boolean; placeholder?: string; max?: number }) {
  const [draft, setDraft] = useState('');
  const listId = useId();
  const { data: suggestions } = useData<{ tag: string }[]>(`/search/tags?q=${encodeURIComponent(draft)}`, { keepPreviousData: true });

  function addTags(rawText: string) {
    const merged = mergeTags(tags, rawText, max);
    if (merged !== tags) onChange(merged);
    setDraft('');
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 shadow-sm focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 ${large ? 'min-h-14 py-2.5' : 'min-h-10 py-1.5'}`}
    >
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-sm text-brand-700">
          {tag}
          <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(tags.filter((existing) => existing !== tag))}>
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      <input
        list={listId}
        value={draft}
        placeholder={tags.length > 0 ? '' : placeholder}
        className={`min-w-40 flex-1 bg-transparent outline-none placeholder:text-slate-400 ${large ? 'text-base' : 'text-sm'}`}
        onChange={(event) => (event.target.value.includes(',') ? addTags(event.target.value) : setDraft(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            addTags(draft);
          } else if (event.key === 'Backspace' && !draft && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => addTags(draft)}
        onPaste={(event) => {
          const text = event.clipboardData.getData('text');
          if (/[,\n]/.test(text)) {
            event.preventDefault();
            addTags(text);
          }
        }}
      />
      <datalist id={listId}>{suggestions?.map((suggestion) => <option key={suggestion.tag} value={suggestion.tag} />)}</datalist>
    </div>
  );
}
