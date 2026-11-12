import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

export const config = {
  port: num('PORT', 8787),
  /** The only mint the server accepts stakes from. Defaults to a test mint (fake sats). */
  mintUrl: (process.env.MINT_URL ?? 'https://testnut.cashu.space').replace(/\/+$/, ''),
  dataDir: process.env.DATA_DIR ?? path.resolve(here, '../data'),
  /** Fraction of the jackpot a winning team can take (capped at the room's pot). */
  jackpotShare: num('JACKPOT_SHARE', 0.2),
  /** Built web app to serve, if present. */
  webDist: process.env.WEB_DIST ?? path.resolve(here, '../../web/dist'),
  /** Comma-separated origins allowed to open the WebSocket; empty = any. */
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
