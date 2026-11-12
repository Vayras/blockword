import { afterEach, describe, expect, it } from 'vitest';
import type { RoomView, ServerMsg } from '@blockword/shared';
import { RoomManager, type Bank } from './rooms';

function setup(jackpot = 0) {
  const paid: Array<{ pubkey: string; amount: number; reason: string }> = [];
  const bank: Bank = {
    mintUrl: 'https://mint.test',
    jackpotShare: 0.2,
    jackpot,
    async receive(token: string) {
      const n = Number(token.replace('tok', ''));
      if (!Number.isFinite(n)) throw new Error('bad token');
      return n;
    },
    async payout(pubkey, amount, reason) {
      paid.push({ pubkey, amount, reason });
    },
    async save() {},
  };
  let last: RoomView | null = null;
  const notify = (_pks: string[], msg: ServerMsg) => {
    if (msg.t === 'room') last = msg.room;
  };
  const words = ['NONCE', 'HALVE', 'PROOF'];
  const mgr = new RoomManager(bank, notify, Date.now, () => [...words]);
  return { mgr, bank, paid, view: () => last!, words };
}

const P = ['a1', 'b2', 'c3', 'd4'];
let dispose: (() => void) | null = null;
afterEach(() => dispose?.());

function fillFree(mgr: RoomManager) {
  const room = mgr.create(P[0]!, 'alice', false, 0);
  for (const pk of P.slice(1)) mgr.join(room.code, pk, pk, false);
  return room.code;
}

function play(mgr: RoomManager, code: string, view: () => RoomView, word: string) {
  mgr.guess(code, view().turn!, word);
}

describe('RoomManager', () => {
  it('starts a free room once four players join, and wins after three words', async () => {
    const t = setup();
    dispose = () => t.mgr.dispose();
    const code = fillFree(t.mgr);
    expect(t.view().status).toBe('playing');
    expect(t.view().revealed).toEqual([]);

    play(t.mgr, code, t.view, 'BLOCK');
    expect(t.view().rows[0]!.marks).toEqual(['a', 'a', 'p', 'c', 'a']);
    play(t.mgr, code, t.view, 'NONCE');
    expect(t.view().wordIndex).toBe(1);
    expect(t.view().revealed).toEqual(['NONCE']);
    play(t.mgr, code, t.view, 'HALVE');
    play(t.mgr, code, t.view, 'PROOF');
    await new Promise((r) => setTimeout(r, 0));
    expect(t.view().status).toBe('won');
    expect(t.paid).toEqual([]);
  });

  it('only lets the current player guess', () => {
    const t = setup();
    dispose = () => t.mgr.dispose();
    const code = fillFree(t.mgr);
    const notTurn = P.find((p) => p !== t.view().turn)!;
    expect(() => t.mgr.guess(code, notTurn, 'BLOCK')).toThrow();
    expect(() => t.mgr.guess(code, t.view().turn!, 'ZZZZZ')).toThrow();
  });

  it('loses after six misses and rolls the pot into the jackpot', async () => {
    const t = setup(1000);
    dispose = () => t.mgr.dispose();
    const room = t.mgr.create(P[0]!, 'alice', false, 100);
    for (const pk of P.slice(1)) t.mgr.join(room.code, pk, pk, false);
    for (const pk of P) await t.mgr.stake(room.code, pk, 'tok100');
    expect(t.view().status).toBe('playing');
    expect(t.view().pot).toBe(400);
    for (let i = 0; i < 6; i++) play(t.mgr, room.code, t.view, 'BLOCK');
    await new Promise((r) => setTimeout(r, 0));
    expect(t.view().status).toBe('lost');
    expect(t.bank.jackpot).toBe(1400);
    expect(t.view().revealed).toEqual(['NONCE', 'HALVE', 'PROOF']);
  });

  it('pays stake + capped jackpot share on a win, and refunds overpayment', async () => {
    const t = setup(10_000);
    dispose = () => t.mgr.dispose();
    const room = t.mgr.create(P[0]!, 'alice', false, 100);
    for (const pk of P.slice(1)) t.mgr.join(room.code, pk, pk, false);
    await t.mgr.stake(room.code, P[0]!, 'tok150'); // 50 change refunded
    for (const pk of P.slice(1)) await t.mgr.stake(room.code, pk, 'tok100');
    expect(t.paid).toEqual([{ pubkey: P[0], amount: 50, reason: 'refund' }]);

    for (const w of t.words) play(t.mgr, room.code, t.view, w);
    await new Promise((r) => setTimeout(r, 0));
    // bonus = min(20% of 10,000, pot 400) = 400 → 100 each
    expect(t.view().payouts).toEqual({ a1: 200, b2: 200, c3: 200, d4: 200 });
    expect(t.bank.jackpot).toBe(9600);
    expect(t.paid.filter((p) => p.reason === 'win').length).toBe(4);
  });

  it('refunds a staked player who leaves the lobby', async () => {
    const t = setup();
    dispose = () => t.mgr.dispose();
    const room = t.mgr.create(P[0]!, 'alice', false, 500);
    t.mgr.join(room.code, P[1]!, 'bob', false);
    await t.mgr.stake(room.code, P[1]!, 'tok500');
    await t.mgr.leave(room.code, P[1]!);
    expect(t.paid).toEqual([{ pubkey: P[1], amount: 500, reason: 'refund' }]);
    expect(t.view().seats.length).toBe(1);
  });

  it('rejects an under-stake and refunds it', async () => {
    const t = setup();
    dispose = () => t.mgr.dispose();
    const room = t.mgr.create(P[0]!, 'alice', false, 500);
    await expect(t.mgr.stake(room.code, P[0]!, 'tok100')).rejects.toThrow();
    expect(t.paid).toEqual([{ pubkey: P[0], amount: 100, reason: 'refund' }]);
  });
});
