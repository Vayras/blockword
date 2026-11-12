import { Wallet, getEncodedToken, getTokenMetadata, sumProofs } from '@cashu/cashu-ts';
import { UserError } from './errors';
import type { Store } from './store';

const norm = (url: string) => url.replace(/\/+$/, '').toLowerCase();

/**
 * Holds room stakes as Cashu ecash at one trusted mint.
 * All wallet operations run one at a time so the same proofs are never spent twice.
 */
export class Escrow {
  private wallet: Wallet;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly mintUrl: string,
    private store: Store,
  ) {
    this.wallet = new Wallet(mintUrl);
  }

  async init(): Promise<void> {
    await this.wallet.loadMint();
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Validates a stake token, swaps it for fresh proofs and returns the sats credited. */
  receive(token: string): Promise<number> {
    let meta: ReturnType<typeof getTokenMetadata>;
    try {
      meta = getTokenMetadata(token.trim());
    } catch {
      throw new UserError("That doesn't look like a Cashu token.");
    }
    if (norm(meta.mint) !== norm(this.mintUrl)) {
      throw new UserError(`Rooms only accept ecash from ${this.mintUrl}.`);
    }
    if ((meta.unit ?? 'sat') !== 'sat') {
      throw new UserError('Stakes must be in sats.');
    }
    return this.exclusive(async () => {
      let proofs;
      try {
        proofs = await this.wallet.receive(token.trim());
      } catch (err) {
        throw new UserError(`The mint rejected this token (${(err as Error).message}). It may already be spent.`);
      }
      this.store.addProofs(proofs);
      await this.store.save();
      return sumProofs(proofs).toNumber();
    });
  }

  /** Splits `amount` sats out of the escrow and returns them as an encoded token. */
  pay(amount: number): Promise<string> {
    return this.exclusive(async () => {
      const all = this.store.proofs();
      const { keep, send } = await this.wallet.send(amount, all);
      this.store.setProofs(keep);
      await this.store.save();
      return getEncodedToken({ mint: this.mintUrl, unit: 'sat', proofs: send });
    });
  }

  balance(): number {
    return this.store.balance();
  }
}
