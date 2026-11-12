import { useEffect, useState } from 'react';
import { STAKE_OPTIONS, blocksUntilNextWord, normalizeCode, type OpenRoom, type ServerInfo } from '@blockword/shared';
import { Icon, sats } from '../components/ui';
import { apiUrl } from '../config';
import { loadStats } from '../lib/solo';
import type { Identity } from '../lib/identity';
import { SoloGame } from './SoloGame';

interface Props {
  wide: boolean;
  identity: Identity;
  height: number | null;
  live: boolean;
  info: ServerInfo | null;
  online: boolean;
  onPlaySolo: () => void;
  onCreate: (stake: number) => void;
  onJoin: (code: string) => void;
  onNostr: () => void;
  onSignOut: () => void;
}

export function Home(p: Props) {
  const [stake, setStake] = useState<number>(1000);
  const [code, setCode] = useState('');
  const [rooms, setRooms] = useState<OpenRoom[]>([]);
  const [statsTick, setStatsTick] = useState(0);
  const stats = loadStats();
  void statsTick;

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(apiUrl('/api/rooms'))
        .then((r) => (r.ok ? (r.json() as Promise<OpenRoom[]>) : []))
        .then((list) => alive && setRooms(list))
        .catch(() => undefined);
    void load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const stakes = p.info?.stakes ?? [...STAKE_OPTIONS];

  const identityRow = (
    <div className="identity">
      <div className="col">
        <span className="muted small">Playing as</span>
        <span className="mono strong">
          {p.identity.name}
          {p.identity.kind === 'guest' ? ' · no account' : ' · Nostr'}
        </span>
      </div>
      {p.identity.kind === 'guest' ? (
        <button type="button" className="btn-link" onClick={p.onNostr}>
          Link Nostr
        </button>
      ) : (
        <button type="button" className="btn-link muted" onClick={p.onSignOut}>
          Use guest
        </button>
      )}
    </div>
  );

  const coop = (
    <section className="card coop-card">
      <div className="row-between">
        <h2>Co-op room</h2>
        <span className="avatars" aria-hidden="true">
          {['#F472B6', '#A78BFA', '#34D399', '#FBBF24'].map((c) => (
            <i key={c} style={{ background: c }} />
          ))}
        </span>
      </div>
      <p className="muted">4 players, one 10-minute block, 3 words to solve together. Stake ecash; solve them all and split the jackpot.</p>
      <div className="row-between inset">
        <span className="muted small">Jackpot</span>
        <span className="mono accent strong">{p.info ? `${sats(p.info.jackpot)} sats` : '—'}</span>
      </div>
      <div className="chips" role="radiogroup" aria-label="Stake per player">
        {stakes.map((s) => (
          <button type="button" role="radio" aria-checked={stake === s} key={s} className={`chip ${stake === s ? 'is-on' : ''}`} onClick={() => setStake(s)}>
            {s === 0 ? 'Free' : `${sats(s)} sats`}
          </button>
        ))}
      </div>
      <div className="two-col">
        <button type="button" className="btn btn-light" disabled={!p.online} onClick={() => p.onCreate(stake)}>
          Create room
        </button>
        <form
          className="join-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 4) p.onJoin(code);
          }}
        >
          <label className="sr-only" htmlFor="code">
            Room code
          </label>
          <input id="code" value={code} onChange={(e) => setCode(normalizeCode(e.target.value))} placeholder="CODE" autoComplete="off" />
          <button type="submit" className="btn btn-small" disabled={code.length !== 4 || !p.online}>
            Join
          </button>
        </form>
      </div>
      {!p.online && <span className="muted small">Connecting to the game server…</span>}
    </section>
  );

  const openRooms = rooms.length > 0 && (
    <section className="card">
      <h3>Open rooms</h3>
      <ul className="room-list">
        {rooms.map((r) => (
          <li key={r.code}>
            <button type="button" className="room-item" onClick={() => p.onJoin(r.code)} disabled={!p.online}>
              <span className="mono strong">{r.code}</span>
              <span className="muted small">{r.seats} / 4 seats</span>
              <span className="mono accent small">{r.stake ? `${sats(r.stake)} sats` : 'Free'}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  const statsRow = (
    <section className="stats">
      <div>
        <strong className="mono">{stats.streak}</strong>
        <span className="muted small">Streak</span>
      </div>
      <div>
        <strong className="mono">{stats.played}</strong>
        <span className="muted small">Played</span>
      </div>
      <div>
        <strong className="mono">{stats.played ? Math.round((stats.won / stats.played) * 100) : 0}%</strong>
        <span className="muted small">Solved</span>
      </div>
    </section>
  );

  if (p.wide) {
    return (
      <div className="home-wide">
        <section className="card solo-panel">
          <h1>Mine today's word</h1>
          {p.height !== null ? <SoloGame height={p.height} live={p.live} active onFinished={() => setStatsTick((n) => n + 1)} /> : <div className="loading">Finding the chain tip…</div>}
        </section>
        <aside className="home-side">
          {identityRow}
          {coop}
          {openRooms}
          {statsRow}
        </aside>
      </div>
    );
  }

  return (
    <div className="screen home">
      {identityRow}
      <section className="card hero">
        <span className="mono muted small">{p.height !== null ? `BLOCK #${p.height.toLocaleString('en-US')}` : 'FINDING THE CHAIN TIP…'}</span>
        <h1>Mine today's word</h1>
        <div className="mini-tiles" aria-hidden="true">
          <i className="tile-c">B</i>
          <i className="tile-p">?</i>
          <i className="tile-a">?</i>
          <i />
          <i />
        </div>
        <p className="muted">5-letter Bitcoin words. 6 attempts. A new word every 144 blocks (about a day).</p>
        <button type="button" className="btn btn-primary" onClick={p.onPlaySolo} disabled={p.height === null}>
          Play solo <Icon name="bolt" size={16} />
        </button>
        {p.height !== null && <span className="muted small center">Next word in ~{blocksUntilNextWord(p.height)} blocks</span>}
      </section>
      {coop}
      {openRooms}
      {statsRow}
    </div>
  );
}
