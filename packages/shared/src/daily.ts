import { ANSWERS } from './words';

/** A new solo word every 144 blocks (about one day). */
export const BLOCKS_PER_WORD = 144;

export function dailyIndex(height: number): number {
  return Math.floor(height / BLOCKS_PER_WORD);
}

export function blocksUntilNextWord(height: number): number {
  return BLOCKS_PER_WORD - (height % BLOCKS_PER_WORD);
}

/** Deterministic, well-mixed pick so consecutive days don't walk the list in order. */
export function dailyAnswer(index: number): string {
  let x = (index ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return ANSWERS[x % ANSWERS.length]!;
}

/**
 * Rough block height from the clock, used only when the mempool API is unreachable.
 * Anchored to block 840,000 (the 2024 halving, 2024-04-20 00:09 UTC) at ~10 minutes per block.
 */
export function estimateHeight(nowMs: number = Date.now()): number {
  const anchorHeight = 840_000;
  const anchorMs = Date.UTC(2024, 3, 20, 0, 9);
  return anchorHeight + Math.max(0, Math.floor((nowMs - anchorMs) / 600_000));
}
