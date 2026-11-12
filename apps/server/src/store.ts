import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deserializeProofs, serializeProofs, sumProofs, type Proof } from '@cashu/cashu-ts';

export interface PendingPayout {
  id: string;
  token: string;
  amount: number;
  reason: 'win' | 'refund';
  createdAt: number;
}

/** A payout we owe but could not mint yet (e.g. the mint was down). Retried on reconnect. */
export interface Owed {
  amount: number;
  reason: 'win' | 'refund';
}

interface StateFile {
  proofs: string[];
  jackpot: number;
  pending: Record<string, PendingPayout[]>;
  owed: Record<string, Owed[]>;
}

/**
 * Tiny JSON-file store. The escrow's proofs ARE the money, so every change is written
 * atomically (temp file + rename) before the caller continues.
 */
export class Store {
  private state: StateFile = { proofs: [], jackpot: 0, pending: {}, owed: {} };
  private file: string;
  private writing: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'state.json');
  }

  async load(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<StateFile>;
      this.state = {
        proofs: raw.proofs ?? [],
        jackpot: raw.jackpot ?? 0,
        pending: raw.pending ?? {},
        owed: raw.owed ?? {},
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  save(): Promise<void> {
    const snapshot = JSON.stringify(this.state, null, 2);
    this.writing = this.writing.then(async () => {
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, snapshot, 'utf8');
      await rename(tmp, this.file);
    });
    return this.writing;
  }

  proofs(): Proof[] {
    return deserializeProofs(this.state.proofs);
  }

  setProofs(proofs: Proof[]): void {
    this.state.proofs = serializeProofs(proofs);
  }

  addProofs(proofs: Proof[]): void {
    this.state.proofs = [...this.state.proofs, ...serializeProofs(proofs)];
  }

  balance(): number {
    return sumProofs(this.proofs()).toNumber();
  }

  get jackpot(): number {
    return this.state.jackpot;
  }

  set jackpot(v: number) {
    this.state.jackpot = Math.max(0, Math.floor(v));
  }

  pendingFor(pubkey: string): PendingPayout[] {
    return this.state.pending[pubkey] ?? [];
  }

  addPending(pubkey: string, p: PendingPayout): void {
    (this.state.pending[pubkey] ??= []).push(p);
  }

  ackPending(pubkey: string, id: string): void {
    const list = (this.state.pending[pubkey] ?? []).filter((p) => p.id !== id);
    if (list.length) this.state.pending[pubkey] = list;
    else delete this.state.pending[pubkey];
  }

  owedFor(pubkey: string): Owed[] {
    return this.state.owed[pubkey] ?? [];
  }

  addOwed(pubkey: string, o: Owed): void {
    (this.state.owed[pubkey] ??= []).push(o);
  }

  clearOwed(pubkey: string): void {
    delete this.state.owed[pubkey];
  }
}
