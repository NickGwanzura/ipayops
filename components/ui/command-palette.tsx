'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useDialogFocus } from '@/app/dialog-focus';

type Hit = { id: string; type: string; title: string; detail: string; href: string };

/** Ctrl/⌘ + K opens a cross-module search (clients, quotes, sales, invoices, serial numbers, purchase orders). */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  return open ? <PaletteDialog close={() => setOpen(false)} /> : null;
}

function PaletteDialog({ close }: { close: () => void }) {
  const dialog = useDialogFocus<HTMLDivElement>(close);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Hit[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const value = term.trim();
    if (value.length < 2) {
      setResults([]);
      setState('idle');
      return;
    }
    setState('loading');
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(value)}`, { cache: 'no-store', signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error('Search failed');
          const data = (await response.json()) as { results: Hit[] };
          setResults(data.results);
          setActive(0);
          setState('idle');
        })
        .catch((error) => {
          if (error?.name !== 'AbortError') setState('error');
        });
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  const go = (hit: Hit) => {
    close();
    // Workspaces read the module, tab and search from window.location when they mount, so use a full page load.
    window.location.assign(hit.href);
  };

  return (
    <div
      className="workflow-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialog}
        className="workflow-dialog command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search everything"
        tabIndex={-1}
      >
        <div className="command-palette-input">
          <Search size={16} aria-hidden="true" />
          <input
            ref={input}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((current) => Math.min(results.length - 1, current + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((current) => Math.max(0, current - 1));
              } else if (event.key === 'Enter' && results[active]) {
                event.preventDefault();
                go(results[active]);
              }
            }}
            placeholder="Search clients, quotes, sales, invoices, serial numbers…"
            autoComplete="off"
          />
        </div>
        <ul id={listId} role="listbox" className="command-palette-results">
          {results.map((hit, index) => (
            <li
              key={`${hit.type}-${hit.id}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'active' : undefined}
              onMouseEnter={() => setActive(index)}
              onClick={() => go(hit)}
            >
              <span className="command-palette-type">{hit.type}</span>
              <span className="command-palette-title">{hit.title}</span>
              <span className="command-palette-detail">{hit.detail}</span>
            </li>
          ))}
        </ul>
        <p className="command-palette-status" role="status">
          {state === 'loading' && 'Searching…'}
          {state === 'error' && 'Search is unavailable right now.'}
          {state === 'idle' && term.trim().length >= 2 && results.length === 0 && 'No matches.'}
          {state === 'idle' && term.trim().length < 2 && 'Type at least two characters. Use ↑ ↓ and Enter.'}
        </p>
      </div>
    </div>
  );
}
