import { randomBytes, randomInt } from 'node:crypto';
import {
  ANSWERS,
  FILL_TIMEOUT_MS,
  MAX_NAME,
  ROUND_MS,
  ROWS_PER_WORD,
  SEATS,
  STAKE_OPTIONS,
  TURN_MS,
  WORDS_PER_ROUND,
  isSolved,
  isValidGuess,
  normalizeCode,
  score,
  type FeedItem,
  type OpenRoom,
  type RoomStatus,
  type RoomView,
  type RowView,
  type ServerMsg,
} from '@blockword/shared';
import { UserError } from './errors';

/** What the room manager needs from the escrow + store; lets tests swap in fakes. */
export interface Bank {
  readonly mintUrl: string;
  receive(token: string): Promise<number>;
  /** Pays `amount` sats to `pubkey` (mint token, remember it until acked, notify). */
  payout(pubkey: string, amount: number, reason: 'win' | 'refund'): Promise<void>;
  jackpot: number;
  readonly jackpotShare: number;
  save(): Promise<void>;
}

export type Notify = (pubkeys: string[], msg: ServerMsg) => void;

interface Seat {
  pubkey: string;
  name: string;
  linked: boolean;
  staked: number;
  ready: boolean;
  connected: boolean;
}

interface Room {
  code: string;
  stake: number;
  host: string;
  status: RoomStatus;
  seats: Seat[];
  words: string[];
  wordIndex: number;
  rows: RowView[];
  solved: string[];
  turnIdx: number;
  startedAt: number | null;
  endsAt: number | null;
  turnEndsAt: number | null;
  fillDeadline: number | null;
  payouts: Record<string, number> | null;
  feed: FeedItem[];
  roundTimer?: NodeJS.Timeout;
  turnTimer?: NodeJS.Timeout;
  fillTimer?: NodeJS.Timeout;
  cleanupTimer?: NodeJS.Timeout;
  /** Stakes being processed, so a seat can't stake twice concurrently. */
  staking: Set<string>;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const FEED_MAX = 40;
const ENDED_ROOM_TTL_MS = 10 * 60 * 1000;

export function cleanName(name: unknown, pubkey: string): string {
  const s = typeof name === 'string' ? name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, MAX_NAME) : '';
  return s || `guest-${pubkey.slice(0, 4)}`;
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(
    private bank: Bank,
    private notify: Notify,
    private now: () => number = Date.now,
    private pickWords: (n: number) => string[] = randomWords,
  ) {}

  // ---------------------------------------------------------------- queries

  get(code: string): Room | undefined {
    return this.rooms.get(normalizeCode(code));
  }

  openRooms(): OpenRoom[] {
    return [...this.rooms.values()]
      .filter((r) => r.status === 'lobby' && r.seats.length < SEATS)
      .map((r) => ({ code: r.code, stake: r.stake, seats: r.seats.length }));
  }

  roomsOf(pubkey: string): Room[] {
    return [...this.rooms.values()].filter((r) => r.seats.some((s) => s.pubkey === pubkey));
  }

  view(room: Room): RoomView {
    const ended = room.status !== 'lobby' && room.status !== 'playing';
    return {
      code: room.code,
      stake: room.stake,
      mintUrl: this.bank.mintUrl,
      status: room.status,
      host: room.host,
      seats: room.seats.map((s) => ({ ...s })),
      startedAt: room.startedAt,
      endsAt: room.endsAt,
      turn: room.status === 'playing' ? (room.seats[room.turnIdx]?.pubkey ?? null) : null,
      turnEndsAt: room.status === 'playing' ? room.turnEndsAt : null,
      wordIndex: room.wordIndex,
      wordsTotal: WORDS_PER_ROUND,
      rows: room.rows.map((r) => ({ ...r, marks: [...r.marks] })),
      revealed: ended ? [...room.words] : [...room.solved],
      pot: room.seats.reduce((sum, s) => sum + s.staked, 0),
      jackpot: this.bank.jackpot,
      payouts: room.payouts,
      feed: room.feed.slice(-FEED_MAX),
      fillDeadline: room.fillDeadline,
    };
  }

  // ---------------------------------------------------------------- lobby

  create(pubkey: string, name: string, linked: boolean, stake: number): Room {
    if (!(STAKE_OPTIONS as readonly number[]).includes(stake)) {
      throw new UserError(`Stake must be one of ${STAKE_OPTIONS.join(', ')} sats.`);
    }
    let code: string;
    do {
      code = Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));

    const room: Room = {
      code,
      stake,
      host: pubkey,
      status: 'lobby',
      seats: [],
      words: [],
      wordIndex: 0,
      rows: [],
      solved: [],
      turnIdx: 0,
      startedAt: null,
      endsAt: null,
      turnEndsAt: null,
      fillDeadline: null,
      payouts: null,
      feed: [],
      staking: new Set(),
    };
    this.rooms.set(code, room);
    this.addSeat(room, pubkey, name, linked);
    this.log(room, `Room ${code} opened · ${stake ? `${stake} sats each` : 'free play'}`);
    this.broadcast(room);
    return room;
  }

  join(code: string, pubkey: string, name: string, linked: boolean): Room {
    const room = this.mustGet(code);
    const seat = room.seats.find((s) => s.pubkey === pubkey);
    if (seat) {
      seat.connected = true;
      seat.name = name;
      this.broadcast(room);
      return room;
    }
    if (room.status !== 'lobby') throw new UserError('That round has already started.');
    if (room.seats.length >= SEATS) throw new UserError('That room is full.');
    this.addSeat(room, pubkey, name, linked);
    this.log(room, `${name} joined`, pubkey);
    this.broadcast(room);
    this.maybeStart(room);
    return room;
  }

  private addSeat(room: Room, pubkey: string, name: string, linked: boolean) {
    // Free rooms need no stake: joining is being ready.
    room.seats.push({ pubkey, name, linked, staked: 0, ready: room.stake === 0, connected: true });
  }

  async stake(code: string, pubkey: string, token: string): Promise<number> {
    const room = this.mustGet(code);
    const seat = this.mustSeat(room, pubkey);
    if (room.status !== 'lobby') throw new UserError('Stakes are only taken in the lobby.');
    if (room.stake === 0) throw new UserError('This is a free room — no stake needed.');
    if (seat.ready) throw new UserError('You have already staked.');
    if (room.staking.has(pubkey)) throw new UserError('Your stake is already being processed.');

    room.staking.add(pubkey);
    let credited: number;
    try {
      credited = await this.bank.receive(token);
    } finally {
      room.staking.delete(pubkey);
    }

    // The room may have changed while the mint was working.
    const stillSeated = room.seats.find((s) => s.pubkey === pubkey);
    if (room.status !== 'lobby' || !stillSeated || this.rooms.get(room.code) !== room) {
      await this.bank.payout(pubkey, credited, 'refund');
      throw new UserError('The room changed while your stake was processing, so it was refunded.');
    }
    if (credited < room.stake) {
      await this.bank.payout(pubkey, credited, 'refund');
      throw new UserError(`This room needs ${room.stake} sats; your token was worth ${credited}. It was refunded.`);
    }
    if (credited > room.stake) {
      // Return the change so everyone has exactly the same at stake.
      await this.bank.payout(pubkey, credited - room.stake, 'refund');
      credited = room.stake;
    }

    stillSeated.staked = credited;
    stillSeated.ready = true;
    this.log(room, `${stillSeated.name} staked ${credited} sats`, pubkey);
    if (room.fillDeadline === null) {
      room.fillDeadline = this.now() + FILL_TIMEOUT_MS;
      room.fillTimer = setTimeout(() => void this.expireLobby(room), FILL_TIMEOUT_MS);
    }
    this.broadcast(room);
    this.maybeStart(room);
    return credited;
  }

  async leave(code: string, pubkey: string): Promise<void> {
    const room = this.get(code);
    if (!room) return;
    const seat = room.seats.find((s) => s.pubkey === pubkey);
    if (!seat) return;

    if (room.status === 'lobby') {
      room.seats = room.seats.filter((s) => s !== seat);
      this.log(room, `${seat.name} left`, pubkey);
      if (seat.staked > 0) await this.bank.payout(pubkey, seat.staked, 'refund');
      if (room.seats.length === 0) {
        this.close(room);
        return;
      }
      if (room.host === pubkey) room.host = room.seats[0]!.pubkey;
      this.broadcast(room);
    } else {
      // Mid-round or after: just disconnect; your stake rides with the team.
      seat.connected = false;
      this.broadcast(room);
    }
    this.notify([pubkey], { t: 'left', code: room.code });
  }

  setConnected(pubkey: string, connected: boolean): void {
    for (const room of this.roomsOf(pubkey)) {
      const seat = room.seats.find((s) => s.pubkey === pubkey)!;
      if (seat.connected === connected) continue;
      seat.connected = connected;
      this.broadcast(room);
      if (!connected && room.status === 'playing' && room.seats[room.turnIdx]?.pubkey === pubkey) {
        this.advanceTurn(room);
        this.broadcast(room);
      }
    }
  }

  private maybeStart(room: Room) {
    if (room.status !== 'lobby') return;
    if (room.seats.length < SEATS || !room.seats.every((s) => s.ready)) return;
    if (room.fillTimer) clearTimeout(room.fillTimer);
    room.fillDeadline = null;
    room.status = 'playing';
    room.words = this.pickWords(WORDS_PER_ROUND);
    room.startedAt = this.now();
    room.endsAt = room.startedAt + ROUND_MS;
    room.turnIdx = randomInt(room.seats.length);
    room.roundTimer = setTimeout(() => void this.finish(room, false, 'The block closed before the team finished.'), ROUND_MS);
    this.log(room, 'Block started — 10 minutes, 3 words. Go!');
    this.startTurn(room);
    this.broadcast(room);
  }

  private async expireLobby(room: Room) {
    if (room.status !== 'lobby') return;
    room.status = 'refunded';
    this.log(room, "The room didn't fill in time. Stakes refunded.");
    for (const seat of room.seats) {
      if (seat.staked > 0) await this.bank.payout(seat.pubkey, seat.staked, 'refund');
    }
    this.broadcast(room);
    this.scheduleCleanup(room);
  }

  // ---------------------------------------------------------------- play

  guess(code: string, pubkey: string, raw: string): void {
    const room = this.mustGet(code);
    this.mustSeat(room, pubkey);
    if (room.status !== 'playing') throw new UserError('The round is not running.');
    const current = room.seats[room.turnIdx];
    if (current?.pubkey !== pubkey) throw new UserError("It's not your turn.");
    const word = String(raw).toUpperCase().trim();
    if (!/^[A-Z]{5}$/.test(word)) throw new UserError('Guesses are 5 letters.');
    if (!isValidGuess(word)) throw new UserError(`${word} is not in the word list.`);

    const answer = room.words[room.wordIndex]!;
    const marks = score(word, answer);
    room.rows.push({ pubkey, word, marks });
    this.log(room, `${current.name} guessed ${word}`, pubkey);

    if (isSolved(marks)) {
      room.solved.push(answer);
      this.log(room, `${current.name} solved word ${room.wordIndex + 1}: ${answer}`, pubkey);
      if (room.solved.length >= WORDS_PER_ROUND) {
        void this.finish(room, true, 'Block found!');
        return;
      }
      room.wordIndex += 1;
      room.rows = [];
    } else if (room.rows.length >= ROWS_PER_WORD) {
      void this.finish(room, false, `Out of guesses. The word was ${answer}.`);
      return;
    }
    this.advanceTurn(room);
    this.broadcast(room);
  }

  react(code: string, pubkey: string, text: string): void {
    const room = this.mustGet(code);
    const seat = this.mustSeat(room, pubkey);
    const clean = String(text).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);
    if (!clean) return;
    this.log(room, `${seat.name}: ${clean}`, pubkey);
    this.broadcast(room);
  }

  private startTurn(room: Room) {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnEndsAt = this.now() + TURN_MS;
    room.turnTimer = setTimeout(() => {
      if (room.status !== 'playing') return;
      const skipped = room.seats[room.turnIdx];
      if (skipped) this.log(room, `${skipped.name} ran out of time — next player`, skipped.pubkey);
      this.advanceTurn(room);
      this.broadcast(room);
    }, TURN_MS);
  }

  /** Next connected player; if nobody is connected, the turn stays put. */
  private advanceTurn(room: Room) {
    const n = room.seats.length;
    for (let step = 1; step <= n; step++) {
      const idx = (room.turnIdx + step) % n;
      if (room.seats[idx]?.connected) {
        room.turnIdx = idx;
        break;
      }
    }
    this.startTurn(room);
  }

  private async finish(room: Room, won: boolean, message: string) {
    if (room.status !== 'playing') return;
    for (const t of [room.roundTimer, room.turnTimer]) if (t) clearTimeout(t);
    room.turnEndsAt = null;
    room.status = won ? 'won' : 'lost';
    this.log(room, message);

    const pot = room.seats.reduce((sum, s) => sum + s.staked, 0);
    if (pot > 0) {
      if (won) {
        // Bonus from the jackpot, capped at the pot so small rooms can't drain it.
        const bonusTotal = Math.min(Math.floor(this.bank.jackpot * this.bank.jackpotShare), pot);
        const each = Math.floor(bonusTotal / room.seats.length);
        this.bank.jackpot -= each * room.seats.length;
        room.payouts = {};
        for (const seat of room.seats) room.payouts[seat.pubkey] = seat.staked + each;
        await this.bank.save();
        this.broadcast(room);
        for (const seat of room.seats) await this.bank.payout(seat.pubkey, room.payouts[seat.pubkey]!, 'win');
      } else {
        this.bank.jackpot += pot;
        await this.bank.save();
        this.log(room, `${pot} sats rolled into the jackpot.`);
      }
    }
    this.broadcast(room);
    this.scheduleCleanup(room);
  }

  // ---------------------------------------------------------------- helpers

  private mustGet(code: string): Room {
    const room = this.get(code);
    if (!room) throw new UserError('No room with that code.');
    return room;
  }

  private mustSeat(room: Room, pubkey: string): Seat {
    const seat = room.seats.find((s) => s.pubkey === pubkey);
    if (!seat) throw new UserError("You're not in this room.");
    return seat;
  }

  private log(room: Room, text: string, pubkey?: string) {
    room.feed.push({ at: this.now(), text, ...(pubkey ? { pubkey } : {}) });
    if (room.feed.length > FEED_MAX * 2) room.feed = room.feed.slice(-FEED_MAX);
  }

  private broadcast(room: Room) {
    this.notify(
      room.seats.map((s) => s.pubkey),
      { t: 'room', room: this.view(room) },
    );
  }

  private scheduleCleanup(room: Room) {
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => this.close(room), ENDED_ROOM_TTL_MS);
  }

  private close(room: Room) {
    for (const t of [room.roundTimer, room.turnTimer, room.fillTimer, room.cleanupTimer]) if (t) clearTimeout(t);
    this.rooms.delete(room.code);
  }

  /** Stop all timers (tests / shutdown). */
  dispose() {
    for (const room of this.rooms.values()) this.close(room);
  }
}

function randomWords(n: number): string[] {
  const pool = [...ANSWERS];
  const out: string[] = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(randomInt(pool.length), 1)[0]!);
  }
  return out;
}

export function newPayoutId(): string {
  return randomBytes(8).toString('hex');
}
