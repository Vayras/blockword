import { estimateHeight } from '@blockword/shared';

export interface SoloSave {
  index: number;
  guesses: string[];
  done: boolean;
  won: boolean;
}

export interface Stats {
  played: number;
  won: number;
  streak: number;
  lastWonIndex: number | null;
}

const SAVE_KEY = 'blockword.solo';
const STATS_KEY = 'blockword.stats';

export function loadSolo(index: number): SoloSave {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as SoloSave | null;
    if (s && s.index === index) return s;
  } catch {
    /* fresh day */
  }
  return { index, guesses: [], done: false, won: false };
}

export function saveSolo(s: SoloSave) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(s));
}

export function loadStats(): Stats {
  try {
    const s = JSON.parse(localStorage.getItem(STATS_KEY) ?? 'null') as Stats | null;
    if (s) return s;
  } catch {
    /* ignore */
  }
  return { played: 0, won: 0, streak: 0, lastWonIndex: null };
}

export function recordResult(index: number, won: boolean): Stats {
  const s = loadStats();
  s.played += 1;
  if (won) {
    s.won += 1;
    s.streak = s.lastWonIndex === index - 1 ? s.streak + 1 : 1;
    s.lastWonIndex = index;
  } else {
    s.streak = 0;
  }
  localStorage.setItem(STATS_KEY, JSON.stringify(s));
  return s;
}

/** Current Bitcoin block height from mempool.space, or a clock-based estimate if offline. */
export async function fetchTipHeight(): Promise<{ height: number; live: boolean }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch('https://mempool.space/api/blocks/tip/height', { signal: ctrl.signal });
    clearTimeout(timer);
    const height = Number(await res.text());
    if (Number.isFinite(height) && height > 800_000) return { height, live: true };
  } catch {
    /* fall through */
  }
  return { height: estimateHeight(), live: false };
}
