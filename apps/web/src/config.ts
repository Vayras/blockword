/** Where the game server lives. Empty = same origin as the web app (the server can serve it). */
export const API_BASE = (import.meta.env.VITE_SERVER_URL ?? '').replace(/\/+$/, '');

/** Mint used before the server reports its own (they should match). */
export const DEFAULT_MINT = (import.meta.env.VITE_MINT_URL ?? 'https://testnut.cashu.space').replace(/\/+$/, '');

export const PROFILE_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export function wsUrl(): string {
  const base = API_BASE || window.location.origin;
  return `${base.replace(/^http/, 'ws')}/ws`;
}
