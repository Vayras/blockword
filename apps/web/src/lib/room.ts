import { makeAuthEvent } from 'nostr-tools/nip42';
import type { ClientMsg, RoomView, ServerMsg } from '@blockword/shared';
import { wsUrl } from '../config';
import type { Identity } from './identity';

export type ConnState = 'connecting' | 'online' | 'offline';

export interface RoomState {
  conn: ConnState;
  pubkey: string | null;
  room: RoomView | null;
  error: string | null;
}

export interface PayoutHandler {
  (p: { id: string; token: string; amount: number; reason: 'win' | 'refund' }): Promise<void>;
}

/**
 * WebSocket connection to the game server. Signs the server's challenge with the player's
 * Nostr signer (guest key, extension or bunker), keeps reconnecting, and exposes one snapshot.
 */
export class RoomClient {
  private ws: WebSocket | null = null;
  private state: RoomState = { conn: 'offline', pubkey: null, room: null, error: null };
  private listeners = new Set<() => void>();
  private retry = 0;
  private closed = false;
  private wantRoom: string | null = null;
  private onStaked: ((code: string, amount: number) => void) | null = null;
  private onError: ((message: string) => void) | null = null;

  constructor(
    private identity: Identity,
    private onPayout: PayoutHandler,
  ) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = () => this.state;

  private set(patch: Partial<RoomState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  setIdentity(identity: Identity) {
    this.identity = identity;
    this.ws?.close();
  }

  connect() {
    this.closed = false;
    this.set({ conn: 'connecting' });
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onmessage = (ev) => void this.handle(JSON.parse(String(ev.data)) as ServerMsg);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.set({ conn: 'offline', pubkey: null });
      if (this.closed) return;
      const delay = Math.min(15_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }

  private send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.set({ error: "You're offline — reconnecting…" });
  }

  private async handle(msg: ServerMsg) {
    switch (msg.t) {
      case 'challenge': {
        try {
          const event = await this.identity.signer.signEvent(makeAuthEvent(wsUrl(), msg.challenge));
          this.send({ t: 'auth', event, name: this.identity.name, linked: this.identity.kind !== 'guest' });
        } catch (err) {
          this.set({ error: `Could not sign in: ${(err as Error).message}` });
        }
        return;
      }
      case 'authed':
        this.retry = 0;
        this.set({ conn: 'online', pubkey: msg.pubkey, error: null });
        if (this.wantRoom && !this.state.room) this.join(this.wantRoom);
        return;
      case 'room':
        this.set({ room: msg.room });
        return;
      case 'left':
        if (this.state.room?.code === msg.code) this.set({ room: null });
        return;
      case 'staked':
        this.onStaked?.(msg.code, msg.amount);
        return;
      case 'payout':
        try {
          await this.onPayout(msg);
        } finally {
          // Ack either way: if the token was already claimed the wallet throws "spent".
          this.send({ t: 'ack', id: msg.id });
        }
        return;
      case 'error':
        this.set({ error: msg.message });
        this.onError?.(msg.message);
        return;
    }
  }

  clearError() {
    this.set({ error: null });
  }

  create(stake: number) {
    this.send({ t: 'create', stake });
  }

  join(code: string) {
    this.wantRoom = code;
    this.send({ t: 'join', code });
  }

  /** Sends a stake token; resolves when the server credits it, rejects on a server error. */
  stake(code: string, token: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.onStaked = (_c, amount) => {
        this.onStaked = this.onError = null;
        resolve(amount);
      };
      this.onError = (message) => {
        this.onStaked = this.onError = null;
        reject(new Error(message));
      };
      this.send({ t: 'stake', code, token });
    });
  }

  guess(code: string, word: string) {
    this.send({ t: 'guess', code, word });
  }

  react(code: string, text: string) {
    this.send({ t: 'react', code, text });
  }

  leave(code: string) {
    this.wantRoom = null;
    this.send({ t: 'leave', code });
    this.set({ room: null });
  }

  dismissRoom() {
    this.wantRoom = null;
    this.set({ room: null });
  }
}
