import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { normalizeCode, type ServerInfo } from '@blockword/shared';
import { Icon, Logo, sats } from './components/ui';
import { DEFAULT_MINT, apiUrl } from './config';
import { guestIdentity, restoreIdentity, signOut, type Identity } from './lib/identity';
import { EcashWallet } from './lib/wallet';
import { RoomClient } from './lib/room';
import { fetchTipHeight } from './lib/solo';
import { Home } from './screens/Home';
import { SoloGame } from './screens/SoloGame';
import { CoopRound, Lobby, Result } from './screens/Coop';
import { NostrSheet, StakeSheet, WalletSheet } from './screens/Sheets';

type SheetName = 'nostr' | 'wallet' | 'stake' | null;

function useWide(): boolean {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

export function App() {
  const wide = useWide();
  const [identity, setIdentity] = useState<Identity>(() => guestIdentity());
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [tip, setTip] = useState<{ height: number; live: boolean } | null>(null);
  const [view, setView] = useState<'home' | 'solo'>('home');
  const [sheet, setSheet] = useState<SheetName>(null);
  const [toast, setToast] = useState<string | null>(null);

  const mintUrl = info?.mintUrl ?? DEFAULT_MINT;
  const wallet = useMemo(() => new EcashWallet(mintUrl), [mintUrl]);
  const balance = useSyncExternalStore(
    useCallback((fn) => wallet.subscribe(fn), [wallet]),
    () => wallet.balance(),
  );

  const say = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  }, []);

  // Payouts arrive over the socket as Cashu tokens; swap them straight into the wallet.
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const clientRef = useRef<RoomClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new RoomClient(identity, async (p) => {
      try {
        const got = await walletRef.current.receive(p.token);
        say(p.reason === 'win' ? `+${sats(got)} sats won!` : `${sats(got)} sats refunded to your wallet`);
      } catch (err) {
        const msg = (err as Error).message;
        if (!/spent/i.test(msg)) say(`Couldn't receive a payout: ${msg}`);
      }
    });
  }
  const client = clientRef.current;
  const rs = useSyncExternalStore(client.subscribe, client.snapshot);

  useEffect(() => {
    client.connect();
    void restoreIdentity().then((id) => {
      if (id.pubkey !== identity.pubkey) {
        setIdentity(id);
        client.setIdentity(id);
      }
    });
    fetch(apiUrl('/api/info'))
      .then((r) => r.json() as Promise<ServerInfo>)
      .then(setInfo)
      .catch(() => undefined);
    void fetchTipHeight().then(setTip);
    const id = setInterval(() => void fetchTipHeight().then(setTip), 120_000);
    return () => {
      clearInterval(id);
      client.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Invite links: ?room=CODE
  useEffect(() => {
    const code = normalizeCode(new URLSearchParams(window.location.search).get('room') ?? '');
    if (code.length === 4 && rs.conn === 'online' && !rs.room) {
      client.join(code);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [rs.conn, rs.room, client]);

  useEffect(() => {
    if (rs.error) {
      say(rs.error);
      client.clearError();
    }
  }, [rs.error, client, say]);

  const changeIdentity = (id: Identity) => {
    setIdentity(id);
    client.setIdentity(id);
    setSheet(null);
    say(id.kind === 'guest' ? 'Playing as guest' : `Signed in as ${id.name}`);
  };

  const stakeWith = async (token: string) => {
    if (!rs.room) return;
    try {
      await client.stake(rs.room.code, token);
    } catch (err) {
      // The server didn't take it: put the token back in the wallet (if it was refunded instead, it's already spent).
      await wallet.receive(token).catch(() => undefined);
      throw err;
    }
  };

  const room = rs.room;
  const me = rs.pubkey ?? identity.pubkey;
  const roomProps = room && {
    room,
    me,
    balance,
    onStake: () => setSheet('stake'),
    onGuess: (w: string) => client.guess(room.code, w),
    onReact: (t: string) => client.react(room.code, t),
    onLeave: () => client.leave(room.code),
    onHome: () => client.dismissRoom(),
    onNewRoom: () => {
      client.dismissRoom();
      client.create(room.stake);
    },
  };

  let body;
  if (roomProps && room) {
    if (room.status === 'lobby') body = <Lobby {...roomProps} />;
    else if (room.status === 'playing') body = <CoopRound {...roomProps} wide={wide} />;
    else body = <Result {...roomProps} />;
  } else if (view === 'solo' && !wide && tip) {
    body = (
      <div className="screen">
        <SoloGame height={tip.height} live={tip.live} active />
      </div>
    );
  } else {
    body = (
      <Home
        wide={wide}
        identity={identity}
        height={tip?.height ?? null}
        live={tip?.live ?? false}
        info={info}
        online={rs.conn === 'online'}
        onPlaySolo={() => setView('solo')}
        onCreate={(stake) => client.create(stake)}
        onJoin={(code) => client.join(code)}
        onNostr={() => setSheet('nostr')}
        onSignOut={() => changeIdentity(signOut())}
      />
    );
  }

  const showTopBar = !room || room.status !== 'playing' || wide;

  return (
    <div className={`app ${wide ? 'is-wide' : ''}`}>
      {showTopBar && (
        <header className="topbar">
          <div className="topbar-inner">
            <div className="topbar-left">
              {view === 'solo' && !room && !wide ? (
                <button type="button" className="icon-btn" aria-label="Back to home" onClick={() => setView('home')}>
                  <Icon name="back" />
                </button>
              ) : null}
              <button type="button" className="logo-btn" onClick={() => (room ? undefined : setView('home'))} aria-label="Blockword home">
                <Logo />
              </button>
            </div>
            <div className="topbar-right">
              <span className={`conn conn-${rs.conn}`} title={`Game server: ${rs.conn}`} aria-label={`Game server ${rs.conn}`} />
              <button type="button" className="balance-chip" aria-label={`Ecash wallet, ${sats(balance)} sats`} onClick={() => setSheet('wallet')}>
                <Icon name="coin" size={18} color="var(--accent)" />
                <span className="mono">{sats(balance)}</span>
              </button>
            </div>
          </div>
        </header>
      )}

      <main className="main">{body}</main>

      {toast && (
        <div className="snackbar" role="status">
          {toast}
        </div>
      )}

      {sheet === 'nostr' && <NostrSheet identity={identity} onClose={() => setSheet(null)} onLinked={changeIdentity} />}
      {sheet === 'wallet' && <WalletSheet wallet={wallet} balance={balance} onClose={() => setSheet(null)} />}
      {sheet === 'stake' && room && (
        <StakeSheet code={room.code} stake={room.stake} wallet={wallet} balance={balance} onStake={stakeWith} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}
