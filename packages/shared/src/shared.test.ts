import { describe, expect, it } from 'vitest';
import {
  ANSWERS,
  dailyAnswer,
  dailyIndex,
  estimateHeight,
  isValidGuess,
  keyStates,
  normalizeCode,
  score,
} from './index';

describe('score', () => {
  it('marks exact, present and absent letters', () => {
    expect(score('BLOCK', 'NONCE')).toEqual(['a', 'a', 'p', 'c', 'a']);
    expect(score('NODES', 'NONCE')).toEqual(['c', 'c', 'a', 'p', 'a']);
    expect(score('NONCE', 'NONCE')).toEqual(['c', 'c', 'c', 'c', 'c']);
  });

  it('does not over-count repeated letters', () => {
    // the answer's only E is already matched in place, so the other Es are absent
    expect(score('EERIE', 'HALVE')).toEqual(['a', 'a', 'a', 'a', 'c']);
    // both Ns in the answer are matched in place; the third N is absent
    expect(score('NNNAA', 'NONCE')).toEqual(['c', 'a', 'c', 'a', 'a']);
    // one E in the answer, unmatched: only the first guessed E is present
    expect(score('ELDER', 'NONCE')).toEqual(['p', 'a', 'a', 'a', 'a']);
  });

  it('is case-insensitive', () => {
    expect(score('value', 'HALVE')).toEqual(['p', 'c', 'c', 'a', 'c']);
  });
});

describe('keyStates', () => {
  it('keeps the best state per letter', () => {
    const k = keyStates([
      { word: 'MINER', marks: ['a', 'a', 'a', 'p', 'a'] },
      { word: 'VALUE', marks: ['p', 'c', 'c', 'a', 'c'] },
    ]);
    expect(k.E).toBe('c');
    expect(k.V).toBe('p');
    expect(k.M).toBe('a');
  });
});

describe('words', () => {
  it('has only unique 5-letter answers, all valid guesses', () => {
    expect(ANSWERS.length).toBeGreaterThan(40);
    expect(new Set(ANSWERS).size).toBe(ANSWERS.length);
    for (const w of ANSWERS) {
      expect(w).toMatch(/^[A-Z]{5}$/);
      expect(isValidGuess(w)).toBe(true);
    }
  });

  it('rejects junk', () => {
    expect(isValidGuess('ZZZZZ')).toBe(false);
    expect(isValidGuess('ABC')).toBe(false);
  });
});

describe('daily', () => {
  it('is deterministic and changes every 144 blocks', () => {
    expect(dailyIndex(921_447)).toBe(6398);
    expect(dailyIndex(921_600)).toBe(6400);
    expect(dailyAnswer(6398)).toBe(dailyAnswer(6398));
    const picks = new Set(Array.from({ length: 30 }, (_, i) => dailyAnswer(6000 + i)));
    expect(picks.size).toBeGreaterThan(10);
  });

  it('estimates a plausible height', () => {
    expect(estimateHeight(Date.UTC(2024, 3, 20, 0, 9))).toBe(840_000);
    expect(estimateHeight(Date.UTC(2024, 3, 21, 0, 9))).toBe(840_144);
  });
});

describe('room codes', () => {
  it('normalizes', () => {
    expect(normalizeCode(' 7qk-2x ')).toBe('7QK2');
  });
});
