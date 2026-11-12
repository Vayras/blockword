import { useCallback, useEffect, useMemo, useState } from 'react';
import { ROWS_PER_WORD, SEATS, isValidGuess, keyStates, type RoomView } from '@blockword/shared';
import { Board, Icon, Keyboard, PLAYER_COLORS, mmss, sats, useKeyInput, useNow, type BoardRow } from '../components/ui';
import { Legend } from './SoloGame';

interface Props {
  room: RoomView;
  me: string;
  balance: number;
  onStake: () => void;
  onGuess: (word: string) => void;
  onReact: (text: string) => void;
  onLeave: () => void;
  onHome: () => void;
  onNewRoom: () => void;
}

function useSeatLook(room: RoomView) {
  return useMemo(() => {
    const map: Record<string, { color: string; name: string }> = {};
    room.seats.forEach((s, i) => (map[s.pubkey] = { color: PLAYER_COLORS[i % PLAYER_COLORS.length]!, name: s.name }));
    return map;
  }, [room.seats]);
}

// ------------------------------------------------------------------ lobby

export function Lobby({ room, me, onStake, onLeave }: Props) {
  const now = useNow(1000, room.fillDeadline !== null);
  const meSeat = room.seats.find((s) => s.pubkey === me);
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}${window.location.pathname}?room=${room.code}`;

  const copy = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Blockword', text: `Join my Blockword room ${room.code}`, url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      /* user cancelled */
    }
  };

  const pot = room.pot;
  const target = room.stake * SEATS;
  const seats = Array.from({ length: SEATS }, (_, i) => room.seats[i] ?? null);

  return (
    <div className="screen lobby">
      <header className="bar">
        <button type="button" className="icon-btn" aria-label="Leave room" onClick={onLeave}>
          <Icon name="back" />
        </button>
        <div className="bar-title">
          <span className="muted small">Room</span>
          <span className="room-code">{room.code}</span>
        </div>
        <button type="button" className="icon-btn" aria-label="Share invite link" onClick={copy}>
          <Icon name="share" />
        </button>
      </header>
      {copied && <div className="toast toast-inline">Invite link copied</div>}

      <div className="stat-grid">
        <div className="stat">
          <span className="muted small">Block time</span>
          <strong className="mono">10:00</strong>
        </div>
        <div className="stat">
          <span className="muted small">Words</span>
          <strong className="mono">3</strong>
        </div>
        <div className="stat">
          <span className="muted small">Stake each</span>
          <strong className="mono">{room.stake ? sats(room.stake) : 'Free'}</strong>
        </div>
      </div>

      <div className="seat-grid">
        {seats.map((s, i) =>
          s ? (
            <div className={`seat ${s.pubkey === me ? 'seat-me' : ''}`} key={s.pubkey}>
              <span className="avatar" style={{ background: PLAYER_COLORS[i] }}>
                {s.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="seat-name mono">
                {s.name}
                {s.pubkey === me ? ' (you)' : ''}
              </span>
              <span className={`small ${s.ready ? 'ok' : 'warn'}`}>
                {!s.connected ? 'Offline' : s.ready ? (room.stake ? 'Staked' : 'Ready') : 'Not staked yet'}
                {s.linked ? ' · Nostr' : ''}
              </span>
            </div>
          ) : (
            <button type="button" className="seat seat-empty" key={`empty-${i}`} onClick={copy}>
              <span className="avatar avatar-empty">+</span>
              <span className="seat-name mono">Open seat</span>
              <span className="small muted">Tap to invite</span>
            </button>
          ),
        )}
      </div>

      {room.stake > 0 && (
        <div className="card">
          <div className="row-between">
            <span className="muted">Pot</span>
            <strong className="mono">
              {sats(pot)} <span className="muted small">/ {sats(target)} sats</span>
            </strong>
          </div>
          <div className="progress">
            <div style={{ width: `${Math.min(100, (pot / Math.max(1, target)) * 100)}%` }} />
          </div>
          <p className="muted small">
            Solve all 3 words before the block ends: everyone gets their stake back plus a share of the jackpot (
            {sats(room.jackpot)} sats). Run out of time: the pot rolls into the jackpot.
            {room.fillDeadline && ` Refunded automatically if the room hasn't filled in ${mmss(room.fillDeadline - now)}.`}
          </p>
        </div>
      )}

      <div className="actions">
        {room.stake > 0 && meSeat && !meSeat.ready && (
          <button type="button" className="btn btn-primary" onClick={onStake}>
            Stake {sats(room.stake)} sats
          </button>
        )}
        <div className="btn btn-ghost btn-static" aria-live="polite">
          {room.seats.length < SEATS
            ? `Waiting for players · ${room.seats.length}/${SEATS}`
            : room.stake
              ? `Waiting for stakes · ${room.seats.filter((s) => s.ready).length}/${SEATS}`
              : 'Starting…'}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ round

export function CoopRound({ room, me, onGuess, onReact, wide }: Props & { wide: boolean }) {
  const now = useNow(250);
  const look = useSeatLook(room);
  const [current, setCurrent] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const myTurn = room.turn === me;

  // New word or someone else guessed: clear the half-typed row.
  useEffect(() => setCurrent(''), [room.wordIndex, room.rows.length]);

  const rows: BoardRow[] = room.rows.map((r) => ({
    word: r.word,
    marks: r.marks,
    who: { color: look[r.pubkey]?.color ?? '#A1A1AA', label: r.pubkey === me ? 'you' : (look[r.pubkey]?.name ?? '') },
  }));
  const keys = useMemo(() => keyStates(room.rows), [room.rows]);

  const flash = (msg: string) => {
    setToast(msg);
    setShake(true);
    setTimeout(() => setShake(false), 450);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 1600);
  };

  const onKey = useCallback(
    (key: string) => {
      if (!myTurn) return;
      if (key === 'DEL') return setCurrent((c) => c.slice(0, -1));
      if (key !== 'ENTER') return setCurrent((c) => (c.length < 5 ? c + key : c));
      if (current.length < 5) return flash('Not enough letters');
      if (!isValidGuess(current)) return flash('Not in the word list');
      onGuess(current);
    },
    [myTurn, current, onGuess],
  );
  useKeyInput(onKey, myTurn);

  const left = room.endsAt ? room.endsAt - now : 0;
  const total = room.startedAt && room.endsAt ? room.endsAt - room.startedAt : 1;
  const turnLeft = room.turnEndsAt ? room.turnEndsAt - now : 0;
  const turnName = room.turn ? (room.turn === me ? 'Your turn' : `${look[room.turn]?.name ?? '…'}'s turn`) : '';

  const header = (
    <header className="round-head">
      <div className="row-between">
        <div className="col">
          <span className="muted small">Block time left</span>
          <span className="timer mono">{mmss(left)}</span>
        </div>
        <div className="col col-end">
          {room.pot > 0 ? <span className="mono accent strong">{sats(room.pot)} sats</span> : <span className="muted small">Free room</span>}
          <span className="dots" aria-label={`Word ${room.wordIndex + 1} of ${room.wordsTotal}`}>
            <span className="muted small">
              Word {room.wordIndex + 1} of {room.wordsTotal}
            </span>
            {Array.from({ length: room.wordsTotal }, (_, i) => (
              <i key={i} className={i < room.revealed.length ? 'dot dot-done' : i === room.wordIndex ? 'dot dot-now' : 'dot'} />
            ))}
          </span>
        </div>
      </div>
      <div className="progress progress-thin" role="progressbar" aria-label="Time left" aria-valuenow={Math.round((left / total) * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${Math.max(0, (left / total) * 100)}%` }} />
      </div>
    </header>
  );

  const team = (
    <div className={wide ? 'team-list' : 'team-strip'}>
      {room.seats.map((s, i) => (
        <div className={`team-member ${room.turn === s.pubkey ? 'is-turn' : ''}`} key={s.pubkey} style={{ ['--c' as string]: PLAYER_COLORS[i] }}>
          <span className="avatar" style={{ background: PLAYER_COLORS[i] }}>
            {s.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="team-name">
            {s.pubkey === me ? 'You' : s.name}
            {wide && <small className="muted">{!s.connected ? 'offline' : room.turn === s.pubkey ? 'guessing now' : s.staked ? `staked ${sats(s.staked)}` : 'ready'}</small>}
          </span>
        </div>
      ))}
    </div>
  );

  const board = (
    <section className="round-board">
      <div className={`turn ${myTurn ? 'turn-me' : ''}`} aria-live="polite">
        {turnName} · {mmss(turnLeft)}
      </div>
      <div className="board-wrap">
        {toast && <div className="toast">{toast}</div>}
        <Board rows={rows} current={myTurn ? current : ''} total={ROWS_PER_WORD} size="md" showWho shake={shake} />
      </div>
      <div className="reactions">
        {['nice', 'hmm…', 'try E?', 'gg'].map((r) => (
          <button type="button" key={r} className="chip" onClick={() => onReact(r)}>
            {r}
          </button>
        ))}
      </div>
      <Keyboard states={keys} onKey={onKey} disabled={!myTurn} />
    </section>
  );

  if (!wide) {
    return (
      <div className="screen round">
        {header}
        {team}
        {board}
      </div>
    );
  }

  return (
    <div className="round-wide">
      {header}
      <div className="round-cols">
        <aside className="round-side">
          <h3>Team</h3>
          {team}
          <Legend />
        </aside>
        {board}
        <aside className="round-side">
          <Feed room={room} look={look} onReact={onReact} />
        </aside>
      </div>
    </div>
  );
}

function Feed({ room, look, onReact }: { room: RoomView; look: Record<string, { color: string; name: string }>; onReact: (t: string) => void }) {
  const [text, setText] = useState('');
  const send = () => {
    if (!text.trim()) return;
    onReact(text);
    setText('');
  };
  return (
    <div className="card feed">
      <h3>Feed</h3>
      <ul>
        {room.feed.slice(-12).map((f, i) => (
          <li key={`${f.at}-${i}`}>
            <i className="dot" style={{ background: f.pubkey ? (look[f.pubkey]?.color ?? '#71717A') : '#71717A' }} />
            <span>{f.text}</span>
          </li>
        ))}
      </ul>
      <form
        className="feed-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label className="sr-only" htmlFor="feed-msg">
          Suggest a word
        </label>
        <input id="feed-msg" value={text} onChange={(e) => setText(e.target.value)} placeholder="Suggest a word…" maxLength={80} />
        <button type="submit" className="btn btn-small">
          Send
        </button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ result

export function Result({ room, me, onHome, onNewRoom }: Props) {
  const won = room.status === 'won';
  const refunded = room.status === 'refunded';
  const myPayout = room.payouts?.[me] ?? 0;
  const mySeat = room.seats.find((s) => s.pubkey === me);
  const title = refunded ? 'Room closed' : won ? 'Block found' : 'Block missed';

  return (
    <div className="screen result">
      <div className="result-head">
        <span className="mono muted small">ROOM {room.code}</span>
        <h1 className={won ? 'accent' : ''}>{title}</h1>
        <span className="muted">
          {refunded
            ? "The room didn't fill in time. Your stake was refunded."
            : won
              ? `All ${room.wordsTotal} words solved${room.startedAt ? ` in ${mmss(Date.now() - room.startedAt)}` : ''}.`
              : `The team solved ${Math.min(room.wordIndex, room.wordsTotal)} of ${room.wordsTotal} words.`}
        </span>
      </div>

      {!refunded && (
        <div className="word-cards">
          {room.revealed.map((w) => (
            <div className="word-card mono" key={w}>
              {w}
            </div>
          ))}
        </div>
      )}

      {won && myPayout > 0 && (
        <div className="card card-accent">
          <span className="muted small">You received</span>
          <strong className="big mono">
            {sats(myPayout)} <span className="muted small">sats</span>
          </strong>
          <span className="muted small">
            {sats(mySeat?.staked ?? 0)} stake back + {sats(myPayout - (mySeat?.staked ?? 0))} jackpot share · already in your wallet
          </span>
        </div>
      )}
      {!won && !refunded && room.pot > 0 && (
        <div className="card">
          <span className="muted small">
            {sats(room.pot)} sats rolled into the jackpot, which is now {sats(room.jackpot)} sats. Next team to find a block gets a share.
          </span>
        </div>
      )}

      <ul className="feed-plain">
        {room.feed.slice(-5).map((f, i) => (
          <li key={i} className="muted small">
            {f.text}
          </li>
        ))}
      </ul>

      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={onNewRoom}>
          New room
        </button>
        <button type="button" className="btn btn-ghost" onClick={onHome}>
          Home
        </button>
      </div>
    </div>
  );
}
