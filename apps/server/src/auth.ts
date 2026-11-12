import { randomBytes } from 'node:crypto';
import { verifyEvent, type Event } from 'nostr-tools/pure';
import { AUTH_KIND } from '@blockword/shared';

export function newChallenge(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Checks a NIP-42 style auth event: right kind, our challenge, recent, and a valid signature.
 * Guests sign with a throwaway key generated in the browser, so this works without sign-up.
 * Returns the authenticated pubkey or null.
 */
export function verifyAuth(raw: unknown, challenge: string, nowSec = Math.floor(Date.now() / 1000)): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const event = raw as Event;
  if (event.kind !== AUTH_KIND) return null;
  if (!Array.isArray(event.tags)) return null;
  const tag = event.tags.find((t) => Array.isArray(t) && t[0] === 'challenge');
  if (!tag || tag[1] !== challenge) return null;
  if (typeof event.created_at !== 'number' || Math.abs(nowSec - event.created_at) > 600) return null;
  try {
    return verifyEvent(event) ? event.pubkey : null;
  } catch {
    return null;
  }
}
