import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { PlainKeySigner, type Signer } from 'nostr-tools/signer';
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';
import type { WindowNostr } from 'nostr-tools/nip07';
import { SimplePool } from 'nostr-tools/pool';
import { npubEncode } from 'nostr-tools/nip19';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import { PROFILE_RELAYS } from '../config';

export type IdentityKind = 'guest' | 'extension' | 'bunker';

export interface Identity {
  kind: IdentityKind;
  pubkey: string;
  name: string;
  signer: Signer;
}

type SavedLogin = { kind: 'extension' } | { kind: 'bunker'; bunker: string; clientKey: string };

const GUEST_KEY = 'blockword.guestKey';
const LOGIN_KEY = 'blockword.login';

declare global {
  interface Window {
    nostr?: WindowNostr;
  }
}

export function shortNpub(pubkey: string): string {
  const npub = npubEncode(pubkey);
  return `${npub.slice(0, 9)}…${npub.slice(-4)}`;
}

/**
 * Everyone starts as a guest: a throwaway Nostr key made in this browser.
 * No sign-up, and the server can still tell players apart and route payouts.
 */
export function guestIdentity(): Identity {
  let hex: string | null = localStorage.getItem(GUEST_KEY);
  if (!hex) {
    const fresh = bytesToHex(generateSecretKey());
    localStorage.setItem(GUEST_KEY, fresh);
    hex = fresh;
  }
  const sk = hexToBytes(hex);
  const pubkey = getPublicKey(sk);
  return { kind: 'guest', pubkey, name: `guest-${pubkey.slice(0, 4)}`, signer: new PlainKeySigner(sk) };
}

export function hasExtension(): boolean {
  return typeof window !== 'undefined' && Boolean(window.nostr);
}

/** NIP-07: a browser extension such as Alby or nos2x holds the key. */
export async function extensionIdentity(): Promise<Identity> {
  const nostr = window.nostr;
  if (!nostr) throw new Error('No Nostr extension found in this browser.');
  const pubkey = await nostr.getPublicKey();
  localStorage.setItem(LOGIN_KEY, JSON.stringify({ kind: 'extension' } satisfies SavedLogin));
  const signer: Signer = {
    getPublicKey: () => nostr.getPublicKey(),
    signEvent: (e) => nostr.signEvent(e),
  };
  return { kind: 'extension', pubkey, name: (await fetchName(pubkey)) ?? shortNpub(pubkey), signer };
}

/** NIP-46: a remote signer (Amber, nsec.app, a bunker) holds the key. We never see the nsec. */
export async function bunkerIdentity(input: string): Promise<Identity> {
  const bp = await parseBunkerInput(input.trim());
  if (!bp) throw new Error('Paste a bunker:// link or a NIP-05 address that supports Nostr Connect.');
  const clientKey = bytesToHex(generateSecretKey());
  const signer = BunkerSigner.fromBunker(hexToBytes(clientKey), bp, {
    onauth: (url) => window.open(url, '_blank', 'noopener'),
  });
  await signer.connect();
  const pubkey = await signer.getPublicKey();
  localStorage.setItem(LOGIN_KEY, JSON.stringify({ kind: 'bunker', bunker: input.trim(), clientKey } satisfies SavedLogin));
  return { kind: 'bunker', pubkey, name: (await fetchName(pubkey)) ?? shortNpub(pubkey), signer };
}

/** Restores the last login, falling back to the guest key if it no longer works. */
export async function restoreIdentity(): Promise<Identity> {
  const raw = localStorage.getItem(LOGIN_KEY);
  if (!raw) return guestIdentity();
  try {
    const saved = JSON.parse(raw) as SavedLogin;
    if (saved.kind === 'extension' && hasExtension()) return await extensionIdentity();
    if (saved.kind === 'bunker') {
      const bp = await parseBunkerInput(saved.bunker);
      if (bp) {
        // Already paired: the bunker knows our client key, so no new connect() is needed.
        const signer = BunkerSigner.fromBunker(hexToBytes(saved.clientKey), bp, {
          onauth: (url) => window.open(url, '_blank', 'noopener'),
        });
        const pubkey = await withTimeout(signer.getPublicKey(), 8000);
        return { kind: 'bunker', pubkey, name: (await fetchName(pubkey)) ?? shortNpub(pubkey), signer };
      }
    }
  } catch (err) {
    console.warn('Could not restore Nostr login, playing as guest', err);
  }
  return guestIdentity();
}

export function signOut(): Identity {
  localStorage.removeItem(LOGIN_KEY);
  return guestIdentity();
}

let pool: SimplePool | null = null;

async function fetchName(pubkey: string): Promise<string | null> {
  try {
    pool ??= new SimplePool();
    const ev = await pool.get(PROFILE_RELAYS, { kinds: [0], authors: [pubkey] }, { maxWait: 2500 });
    if (!ev) return null;
    const meta = JSON.parse(ev.content) as { display_name?: string; name?: string };
    const name = (meta.display_name || meta.name || '').trim();
    return name ? name.slice(0, 24) : null;
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}
