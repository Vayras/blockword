import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { STAKE_OPTIONS, type ClientMsg, type ServerInfo, type ServerMsg } from '@blockword/shared';
import { config } from './config';
import { Store } from './store';
import { Escrow } from './escrow';
import { RoomManager, cleanName, newPayoutId, type Bank } from './rooms';
import { newChallenge, verifyAuth } from './auth';
import { UserError } from './errors';
import { serveStatic } from './static';

interface Client {
  challenge: string;
  pubkey: string | null;
  name: string;
  linked: boolean;
  bucket: { tokens: number; at: number };
}

const store = new Store(config.dataDir);
await store.load();
const escrow = new Escrow(config.mintUrl, store);
await escrow.init();
console.log(`[blockword] mint ${config.mintUrl} · escrow ${escrow.balance()} sats · jackpot ${store.jackpot} sats`);

const sockets = new Map<string, Set<WebSocket>>();
const clients = new Map<WebSocket, Client>();

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function notify(pubkeys: string[], msg: ServerMsg) {
  for (const pk of pubkeys) for (const ws of sockets.get(pk) ?? []) send(ws, msg);
}

const bank: Bank = {
  mintUrl: config.mintUrl,
  jackpotShare: config.jackpotShare,
  get jackpot() {
    return store.jackpot;
  },
  set jackpot(v: number) {
    store.jackpot = v;
  },
  receive: (token) => escrow.receive(token),
  save: () => store.save(),
  async payout(pubkey, amount, reason) {
    if (amount <= 0) return;
    try {
      const token = await escrow.pay(amount);
      const id = newPayoutId();
      store.addPending(pubkey, { id, token, amount, reason, createdAt: Date.now() });
      await store.save();
      notify([pubkey], { t: 'payout', id, token, amount, reason });
    } catch (err) {
      // Never lose track of what we owe: retry next time this player connects.
      console.error(`[blockword] payout of ${amount} to ${pubkey} failed:`, err);
      store.addOwed(pubkey, { amount, reason });
      await store.save();
    }
  },
};

const rooms = new RoomManager(bank, notify);

/** Re-deliver unacknowledged payouts and retry anything we still owe. */
async function settle(pubkey: string) {
  const owed = store.owedFor(pubkey);
  if (owed.length) {
    store.clearOwed(pubkey);
    await store.save();
    for (const o of owed) await bank.payout(pubkey, o.amount, o.reason);
  }
  for (const p of store.pendingFor(pubkey)) {
    notify([pubkey], { t: 'payout', id: p.id, token: p.token, amount: p.amount, reason: p.reason });
  }
}

function allow(c: Client): boolean {
  const now = Date.now();
  c.bucket.tokens = Math.min(20, c.bucket.tokens + ((now - c.bucket.at) / 1000) * 4);
  c.bucket.at = now;
  if (c.bucket.tokens < 1) return false;
  c.bucket.tokens -= 1;
  return true;
}

async function handle(ws: WebSocket, c: Client, msg: ClientMsg) {
  if (msg.t === 'auth') {
    const pubkey = verifyAuth(msg.event, c.challenge);
    if (!pubkey) throw new UserError('Sign-in failed. Please reload.');
    if (c.pubkey && c.pubkey !== pubkey) sockets.get(c.pubkey)?.delete(ws);
    c.pubkey = pubkey;
    c.name = cleanName(msg.name, pubkey);
    c.linked = Boolean(msg.linked);
    if (!sockets.has(pubkey)) sockets.set(pubkey, new Set());
    sockets.get(pubkey)!.add(ws);
    send(ws, { t: 'authed', pubkey });
    rooms.setConnected(pubkey, true);
    for (const room of rooms.roomsOf(pubkey)) send(ws, { t: 'room', room: rooms.view(room) });
    await settle(pubkey);
    return;
  }

  const pubkey = c.pubkey;
  if (!pubkey) throw new UserError('Not signed in yet.');

  switch (msg.t) {
    case 'create':
      rooms.create(pubkey, c.name, c.linked, Number(msg.stake));
      return;
    case 'join':
      rooms.join(String(msg.code), pubkey, c.name, c.linked);
      return;
    case 'stake': {
      const amount = await rooms.stake(String(msg.code), pubkey, String(msg.token));
      send(ws, { t: 'staked', code: String(msg.code).toUpperCase(), amount });
      return;
    }
    case 'guess':
      rooms.guess(String(msg.code), pubkey, String(msg.word));
      return;
    case 'react':
      rooms.react(String(msg.code), pubkey, String(msg.text));
      return;
    case 'leave':
      await rooms.leave(String(msg.code), pubkey);
      return;
    case 'ack':
      store.ackPending(pubkey, String(msg.id));
      await store.save();
      return;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === '/api/health') return json(200, { ok: true });
  if (url.pathname === '/api/info') {
    const info: ServerInfo = {
      mintUrl: config.mintUrl,
      jackpot: store.jackpot,
      stakes: [...STAKE_OPTIONS],
      jackpotShare: config.jackpotShare,
    };
    return json(200, info);
  }
  if (url.pathname === '/api/rooms') return json(200, rooms.openRooms());
  if (url.pathname.startsWith('/api/')) return json(404, { error: 'not found' });

  if (await serveStatic(config.webDist, req, res)) return;
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Blockword server is running. Build the web app (npm run build) to serve it from here.');
});

const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 64 * 1024,
  verifyClient: ({ origin }: { origin: string }) =>
    config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin),
});

wss.on('connection', (ws) => {
  const c: Client = { challenge: newChallenge(), pubkey: null, name: '', linked: false, bucket: { tokens: 20, at: Date.now() } };
  clients.set(ws, c);
  send(ws, { t: 'challenge', challenge: c.challenge });

  ws.on('message', async (data) => {
    if (!allow(c)) return send(ws, { t: 'error', message: 'Slow down a little.' });
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data)) as ClientMsg;
    } catch {
      return send(ws, { t: 'error', message: 'Bad message.' });
    }
    try {
      await handle(ws, c, msg);
    } catch (err) {
      if (err instanceof UserError) send(ws, { t: 'error', message: err.message });
      else {
        console.error('[blockword] error handling', msg.t, err);
        send(ws, { t: 'error', message: 'Something went wrong on the server.' });
      }
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    if (!c.pubkey) return;
    const set = sockets.get(c.pubkey);
    set?.delete(ws);
    if (!set || set.size === 0) {
      sockets.delete(c.pubkey);
      rooms.setConnected(c.pubkey, false);
    }
  });
});

// Keep connections alive through proxies.
setInterval(() => {
  for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.ping();
}, 30_000).unref();

server.listen(config.port, () => {
  console.log(`[blockword] listening on http://localhost:${config.port}`);
});

const shutdown = async () => {
  rooms.dispose();
  await store.save();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
