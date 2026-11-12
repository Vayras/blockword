/** c = right letter, right spot · p = in the word, wrong spot · a = not in the word */
export type Mark = 'c' | 'p' | 'a';

export const WORD_LENGTH = 5;

/**
 * Wordle scoring with correct handling of repeated letters:
 * exact matches are claimed first, then remaining letters are matched left to right
 * against the letters of the answer that are still unclaimed.
 */
export function score(guess: string, answer: string): Mark[] {
  const g = guess.toUpperCase();
  const a = answer.toUpperCase();
  if (g.length !== a.length) throw new Error('guess and answer must be the same length');

  const marks: Mark[] = new Array<Mark>(g.length).fill('a');
  const remaining = new Map<string, number>();

  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) {
      marks[i] = 'c';
    } else {
      const ch = a[i]!;
      remaining.set(ch, (remaining.get(ch) ?? 0) + 1);
    }
  }
  for (let i = 0; i < g.length; i++) {
    if (marks[i] === 'c') continue;
    const ch = g[i]!;
    const left = remaining.get(ch) ?? 0;
    if (left > 0) {
      marks[i] = 'p';
      remaining.set(ch, left - 1);
    }
  }
  return marks;
}

export function isSolved(marks: Mark[]): boolean {
  return marks.length === WORD_LENGTH && marks.every((m) => m === 'c');
}

const RANK: Record<Mark, number> = { a: 0, p: 1, c: 2 };

/** Best-known state for each letter across all scored rows, for colouring the keyboard. */
export function keyStates(rows: ReadonlyArray<{ word: string; marks: Mark[] }>): Record<string, Mark> {
  const out: Record<string, Mark> = {};
  for (const row of rows) {
    const w = row.word.toUpperCase();
    for (let i = 0; i < w.length; i++) {
      const ch = w[i]!;
      const m = row.marks[i];
      if (!m) continue;
      const prev = out[ch];
      if (prev === undefined || RANK[m] > RANK[prev]) out[ch] = m;
    }
  }
  return out;
}
