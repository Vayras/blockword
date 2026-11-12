# Blockword

Mine the word in six guesses. A Bitcoin-flavoured Wordle with:

- **Solo play, no sign-up.** A new 5-letter Bitcoin word every 144 blocks (about a day), keyed to the real chain tip from mempool.space.
- **Co-op rooms.** 4 players, one 10-minute "block", 3 words to solve together on a shared board, taking turns.
- **Ecash stakes (Cashu).** Each player stakes the same amount. Solve all 3 words and everyone gets their stake back plus a share of the jackpot; run out of time and the pot rolls into the jackpot.
- **Optional Nostr identity.** Everyone starts as a guest with a throwaway Nostr key generated in the browser. Players can link a real identity with a NIP-07 extension or a NIP-46 signer (Amber, nsec.app, bunker). The app never asks for an nsec.

Design: see the Blockword canvas (mobile + web screens).

## Stack

| Part | What |
| --- | --- |
| `packages/shared` | Scoring (handles repeated letters), word lists, daily word, message protocol |
| `apps/server` | Node + `ws`. Rooms, timers and turns; NIP-42-style auth with `nostr-tools`; stake escrow and payouts with `@cashu/cashu-ts` |
| `apps/web` | React + Vite. Responsive (phone → desktop); in-browser Cashu wallet (`@cashu/cashu-ts`); identity with `nostr-tools` (`pure`, `signer`, `nip07`, `nip46`, `nip42`) |

## Run it

Requires Node 22.12+.

```bash
npm install
npm run dev:server        # game server on :8787 (uses the test mint by default)
npm run dev:web           # web app on :5173, proxies /api and /ws to the server
```

Production: `npm run build && npm start` — the server serves the built app on one port. Or with Docker:

```bash
docker build -t blockword .
docker run -p 8787:8787 -v blockword-data:/data blockword
```

`npm test` runs the scoring and room-logic tests. `npm run typecheck` checks all three packages.

## How money moves

1. **Stake.** The player's browser wallet makes an exact-amount Cashu token (or the player pastes one, or pays a Lightning invoice that the mint turns into ecash). The server only accepts tokens from its configured `MINT_URL` and immediately swaps them for fresh proofs, so the player can't spend them twice.
2. **Escrow.** The server holds the proofs in `DATA_DIR/state.json` (written atomically after every change). Wallet operations are serialised so the same proofs are never spent twice.
3. **Payout.** On a win, the server splits out tokens and pushes them to each player over the socket. The browser swaps them into its wallet and acks. Unacked payouts are re-sent on reconnect; payouts that fail at the mint are retried when the player next connects.
4. **Refunds.** Leaving the lobby, overpaying, underpaying, or a lobby that doesn't fill within 5 minutes all refund automatically.

## Before using real sats

- The default mint (`testnut.cashu.space`) issues **fake** sats. Keep it that way for testing.
- The server is **custodial** while a round runs: whoever runs it holds the stakes. Back up `DATA_DIR`.
- Real-money games are regulated or banned in many places (including India's 2025 online gaming law). Check the law where you and your players are before enabling real stakes. Free rooms (stake 0) involve no money.
- Rooms live in memory. If the server restarts mid-round, that round's stakes stay in the escrow balance but the round is lost — a TODO is to persist rooms or refund on boot.

## Roadmap ideas

- NIP-46 `nostrconnect://` QR flow (scan with Amber) alongside bunker links
- Publish solo results / room wins as Nostr notes; zaps between teammates
- Persist rooms; admin tool to seed the jackpot
- Proper PWA (manifest + offline solo)
