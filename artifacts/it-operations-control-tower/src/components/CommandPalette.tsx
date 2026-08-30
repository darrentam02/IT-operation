import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft, Command, LayoutDashboard, ArrowUp, ArrowDown } from 'lucide-react';

export type PaletteAction = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
};

function matches(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  let i = 0;
  for (const ch of text.toLowerCase()) {
    if (ch === q[i]) i += 1;
    if (i === q.length) return true;
  }
  return false;
}

export function CommandPalette({ open, onClose, actions }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const results = useMemo(
    () => actions.filter((a) => matches(query, `${a.label} ${a.hint ?? ''} ${a.group}`)),
    [actions, query],
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    } else {
      setQuery('');
    }
  }, [open]);

  useEffect(() => {
    if (index >= results.length) setIndex(Math.max(0, results.length - 1));
  }, [results.length, index]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const grouped = results.reduce<Record<string, PaletteAction[]>>((acc, a) => {
    (acc[a.group] ||= []).push(a);
    return acc;
  }, {});

  const exit = () => onClose();

  const runAction = (a: PaletteAction) => {
    exit();
    a.run();
  };

  return (
    <div className="command-overlay" onClick={exit} data-testid="command-overlay">
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="command-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && results[index]) {
                e.preventDefault();
                runAction(results[index]);
              }
            }}
            placeholder="Search surfaces and actions..."
            data-testid="command-input"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="command-body">
          {!results.length ? (
            <div className="command-empty" data-testid="command-empty">No matches for &ldquo;{query}&rdquo;</div>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div className="command-group" key={group}>
                <div className="command-group-label">
                  <LayoutDashboard size={12} /> {group}
                </div>
                {items.map((a) => {
                  const idx = results.indexOf(a);
                  const active = idx === index;
                  return (
                    <button
                      key={a.id}
                      ref={active ? activeRef : undefined}
                      className={`command-item ${active ? 'command-item-active' : ''}`}
                      onMouseEnter={() => setIndex(idx)}
                      onClick={() => runAction(a)}
                      data-testid={`command-${a.id}`}
                    >
                      <span className="command-item-label">{a.label}</span>
                      {a.hint && <span className="command-item-hint">{a.hint}</span>}
                      <CornerDownLeft size={13} className="command-enter" />
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="command-foot">
          <span><ArrowUp size={11} /><ArrowDown size={11} /> navigate</span>
          <span><CornerDownLeft size={11} /> select</span>
          <span><Command size={11} />K to open</span>
        </div>
      </div>
    </div>
  );
}
