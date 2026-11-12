import type { Mark } from './score';

export const SEATS = 4;
export const WORDS_PER_ROUND = 3;
export const ROWS_PER_WORD = 6;
/** One "block": the whole co-op round. */
export const ROUND_MS = 10 * 60 * 1000;
/** A player who doesn't guess in time is skipped. */
export const TURN_MS = 45 * 1000;
/** A lobby with stakes that doesn't fill in time is refunded. */
export const FILL_TIMEOUT_MS = 5 * 60 * 1000;
/** Stakes a host can choose, in sats. */
export const STAKE_OPTIONS = [0, 100, 500, 1000, 5000] as const;
/** NIP-42 style client auth event kind. */
export const AUTH_KIND = 22242;
export const MAX_NAME = 24;

export type RoomStatus = 'lobby' | 'playing' | 'won' | 'lost' | 'refunded';

export interface SeatView {
  pubkey: string;
  name: string;
  /** True when the player signed in with their own Nostr key instead of a guest key. */
  linked: boolean;
  /** Sats credited from this player's stake (0 until staked). */
  staked: number;
  /** Staked (or joined a free room) and ready to play. */
  ready: boolean;
  connected: boolean;
}

export interface RowView {
  pubkey: string;
  word: string;
  marks: Mark[];
}

export interface FeedItem {
  at: number;
  pubkey?: string;
  text: string;
}

export interface RoomView {
  code: string;
  stake: number;
  mintUrl: string;
  status: RoomStatus;
  host: string;
  seats: SeatView[];
  startedAt: number | null;
  endsAt: number | null;
  turn: string | null;
  turnEndsAt: number | null;
  wordIndex: number;
  wordsTotal: number;
  rows: RowView[];
  /** Words the team has solved so far (plus all words once the round is over). */
  revealed: string[];
  pot: number;
  jackpot: number;
  /** Sats paid to each player when the round is won. */
  payouts: Record<string, number> | null;
  feed: FeedItem[];
  fillDeadline: number | null;
}

export interface OpenRoom {
  code: string;
  stake: number;
  seats: number;
}

export interface ServerInfo {
  mintUrl: string;
  jackpot: number;
  stakes: number[];
  jackpotShare: number;
}

export type ClientMsg =
  | { t: 'auth'; event: unknown; name: string; linked: boolean }
  | { t: 'create'; stake: number }
  | { t: 'join'; code: string }
  | { t: 'stake'; code: string; token: string }
  | { t: 'guess'; code: string; word: string }
  | { t: 'react'; code: string; text: string }
  | { t: 'leave'; code: string }
  | { t: 'ack'; id: string };

export type ServerMsg =
  | { t: 'challenge'; challenge: string }
  | { t: 'authed'; pubkey: string }
  | { t: 'room'; room: RoomView }
  | { t: 'left'; code: string }
  | { t: 'payout'; id: string; token: string; amount: number; reason: 'win' | 'refund' }
  | { t: 'staked'; code: string; amount: number }
  | { t: 'error'; message: string; code?: string };

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

export function shortName(pubkey: string): string {
  return `guest-${pubkey.slice(0, 4)}`;
}
