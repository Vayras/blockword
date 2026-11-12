import { useEffect, useState, type ReactNode } from 'react';
import type { Mark } from '@blockword/shared';

export const PLAYER_COLORS = ['#F472B6', '#A78BFA', '#34D399', '#FBBF24'];

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`logo ${small ? 'logo-sm' : ''}`}>
      <span className="logo-mark" aria-hidden="true">
        <span style={{ background: 'var(--accent)' }} />
        <span style={{ background: 'var(--absent)' }} />
        <span style={{ background: 'var(--present)' }} />
        <span style={{ background: 'var(--accent)' }} />
      </span>
      <span className="logo-word">BLOCKWORD</span>
    </span>
  );
}

const PATHS: Record<string, ReactNode> = {
  back: <path d="M15 18l-6-6 6-6" />,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  coin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 8h4.5a2 2 0 0 1 0 4H9V8zm0 4h5a2 2 0 0 1 0 4H9v-4zm2-6v2m0 8v2" />
    </>
  ),
  share: (
    <>
      <path d="M12 3v12M7 8l5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>
  ),
};

export function Icon({ name, size = 20, color = 'currentColor' }: { name: keyof typeof PATHS; size?: number; color?: string }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}

export interface BoardRow {
  word: string;
  marks?: Mark[];
  who?: { color: string; label: string };
}

export function Board({
  rows,
  current,
  total = 6,
  size = 'lg',
  showWho = false,
  shake = false,
}: {
  rows: BoardRow[];
  current: string | null;
  total?: number;
  size?: 'lg' | 'md';
  showWho?: boolean;
  shake?: boolean;
}) {
  const lines: Array<BoardRow & { typing?: boolean }> = [...rows];
  if (current !== null && lines.length < total) lines.push({ word: current, typing: true });
  while (lines.length < total) lines.push({ word: '' });

  return (
    <div className={`board board-${size}`} role="grid" aria-label="Guess board">
      {lines.map((row, r) => (
        <div className={`board-row ${row.typing && shake ? 'shake' : ''}`} role="row" key={r}>
          {showWho && (
            <span className="who" style={{ color: row.who?.color ?? 'transparent' }}>
              {row.who?.label ?? ''}
            </span>
          )}
          {Array.from({ length: 5 }, (_, i) => {
            const ch = row.word[i] ?? '';
            const mark = row.marks?.[i];
            const cls = mark ? `tile tile-${mark}` : ch ? 'tile tile-typed' : 'tile';
            const label = mark ? `${ch}, ${mark === 'c' ? 'right spot' : mark === 'p' ? 'in the word' : 'not in the word'}` : ch || 'empty';
            return (
              <div className={cls} role="gridcell" aria-label={label} key={i} style={mark ? { animationDelay: `${i * 90}ms` } : undefined}>
                {ch}
              </div>
            );
          })}
          {showWho && <span className="who" aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}

const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

export function Keyboard({
  states,
  onKey,
  disabled = false,
}: {
  states: Record<string, Mark>;
  onKey: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`keyboard ${disabled ? 'is-disabled' : ''}`} aria-label="Keyboard">
      {KEY_ROWS.map((row, r) => (
        <div className="key-row" key={r}>
          {r === 2 && (
            <button type="button" className="key key-wide" onClick={() => onKey('ENTER')} disabled={disabled}>
              ENTER
            </button>
          )}
          {row.split('').map((k) => (
            <button
              type="button"
              key={k}
              className={`key ${states[k] ? `key-${states[k]}` : ''}`}
              onClick={() => onKey(k)}
              disabled={disabled}
            >
              {k}
            </button>
          ))}
          {r === 2 && (
            <button type="button" className="key key-wide" aria-label="Delete letter" onClick={() => onKey('DEL')} disabled={disabled}>
              DEL
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Lets players type on a physical keyboard (ignored while typing in a text field). */
export function useKeyInput(onKey: (key: string) => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter') onKey('ENTER');
      else if (e.key === 'Backspace') onKey('DEL');
      else if (/^[a-zA-Z]$/.test(e.key)) onKey(e.key.toUpperCase());
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onKey, active]);
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function sats(n: number): string {
  return n.toLocaleString('en-US');
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Current time, refreshed every `ms` while active — for countdowns. */
export function useNow(ms = 500, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, active]);
  return now;
}
