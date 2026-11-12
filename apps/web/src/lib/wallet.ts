import {
  Wallet,
  MintQuoteState,
  getEncodedToken,
  getTokenMetadata,
  serializeProofs,
  deserializeProofs,
  sumProofs,
  type Proof,
} from '@cashu/cashu-ts';

const norm = (url: string) => url.replace(/\/+$/, '').toLowerCase();

export interface TopUp {
  quote: string;
  request: string;
  amount: number;
}

/**
 * A small Cashu wallet that lives in this browser (localStorage).
 * It talks to one mint — the one the game server accepts stakes from.
 */
export class EcashWallet {
  private wallet: Wallet;
  private ready: Promise<void>;
  private chain: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private readonly key: string;

  constructor(readonly mintUrl: string) {
    this.key = `blockword.proofs.${norm(mintUrl)}`;
    this.wallet = new Wallet(mintUrl);
    this.ready = this.wallet.loadMint();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private load(): Proof[] {
    try {
      return deserializeProofs(localStorage.getItem(this.key) ?? '[]');
    } catch {
      return [];
    }
  }

  private save(proofs: Proof[]) {
    localStorage.setItem(this.key, JSON.stringify(serializeProofs(proofs)));
    this.emit();
  }

  balance(): number {
    return sumProofs(this.load()).toNumber();
  }

  /** Run wallet operations one at a time so proofs are never used twice. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      await this.ready;
      return fn();
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Receive a pasted token. Returns the sats added. */
  receive(token: string): Promise<number> {
    const t = token.trim();
    let mint: string;
    try {
      mint = getTokenMetadata(t).mint;
    } catch {
      return Promise.reject(new Error("That doesn't look like a Cashu token."));
    }
    if (norm(mint) !== norm(this.mintUrl)) {
      return Promise.reject(new Error(`This wallet only holds ecash from ${this.mintUrl}.`));
    }
    return this.exclusive(async () => {
      const proofs = await this.wallet.receive(t);
      this.save([...this.load(), ...proofs]);
      return sumProofs(proofs).toNumber();
    });
  }

  /** Make an exact-amount token to hand to someone else (e.g. a room stake). */
  sendToken(amount: number): Promise<string> {
    return this.exclusive(async () => {
      const proofs = this.load();
      if (sumProofs(proofs).toNumber() < amount) throw new Error('Not enough sats in your wallet.');
      const { keep, send } = await this.wallet.send(amount, proofs);
      this.save(keep);
      return getEncodedToken({ mint: this.mintUrl, unit: 'sat', proofs: send });
    });
  }

  /** Ask the mint for a Lightning invoice; pay it, then call `claimTopUp`. */
  topUp(amount: number): Promise<TopUp> {
    return this.exclusive(async () => {
      const q = await this.wallet.createMintQuoteBolt11(amount);
      return { quote: q.quote, request: q.request, amount };
    });
  }

  /** Mints the sats if the invoice was paid. Returns true once they're in the wallet. */
  claimTopUp(t: TopUp): Promise<boolean> {
    return this.exclusive(async () => {
      const q = await this.wallet.checkMintQuoteBolt11(t.quote);
      if (q.state === MintQuoteState.ISSUED) return true;
      if (q.state !== MintQuoteState.PAID) return false;
      const proofs = await this.wallet.mintProofsBolt11(t.amount, t.quote);
      this.save([...this.load(), ...proofs]);
      return true;
    });
  }

  /** Pay a Lightning invoice from the wallet (cash out). Returns sats spent incl. fees. */
  payInvoice(invoice: string): Promise<number> {
    return this.exclusive(async () => {
      const quote = await this.wallet.createMeltQuoteBolt11(invoice.trim());
      const need = quote.amount.add(quote.fee_reserve);
      const proofs = this.load();
      if (sumProofs(proofs).lessThan(need)) throw new Error(`You need ${need.toString()} sats including the fee reserve.`);
      const { keep, send } = await this.wallet.send(need, proofs, { includeFees: true });
      this.save(keep);
      const res = await this.wallet.meltProofsBolt11(quote, send);
      this.save([...this.load(), ...res.change]);
      return need.toNumber() - sumProofs(res.change).toNumber();
    });
  }
}
