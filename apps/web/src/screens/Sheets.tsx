import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Icon, Sheet, sats } from '../components/ui';
import { bunkerIdentity, extensionIdentity, hasExtension, type Identity } from '../lib/identity';
import type { EcashWallet, TopUp } from '../lib/wallet';

// ------------------------------------------------------------------ Nostr (optional)

export function NostrSheet({ identity, onClose, onLinked }: { identity: Identity; onClose: () => void; onLinked: (id: Identity) => void }) {
  const [bunker, setBunker] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<Identity>) => {
    setBusy(label);
    setError(null);
    try {
      onLinked(await fn());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet title="Link your Nostr identity" onClose={onClose}>
      <span className="pill">Optional</span>
      <p className="muted">
        You can keep playing as <span className="mono strong">{identity.name}</span>. Your stats stay on this device. Link Nostr if you want to:
      </p>
      <ul className="benefits">
        <li>Use your Nostr name in rooms</li>
        <li>Play with the same identity on every device</li>
        <li>Let friends find you by npub</li>
      </ul>

      <div className="stack">
        <button type="button" className="btn btn-nostr" disabled={!hasExtension() || busy !== null} onClick={() => run('ext', extensionIdentity)}>
          {busy === 'ext' ? 'Waiting for extension…' : 'Browser extension'}
          <span className="btn-note">{hasExtension() ? 'NIP-07' : 'none found'}</span>
        </button>
        <label className="field-label" htmlFor="bunker">
          Signer app or bunker (Amber, nsec.app…)
        </label>
        <div className="field-row">
          <input id="bunker" value={bunker} onChange={(e) => setBunker(e.target.value)} placeholder="bunker://… or name@domain" autoComplete="off" />
          <button type="button" className="btn btn-small" disabled={!bunker.trim() || busy !== null} onClick={() => run('bunker', () => bunkerIdentity(bunker))}>
            {busy === 'bunker' ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <p className="note">
        <Icon name="lock" size={16} /> We never ask for your nsec. Signing happens in your extension or signer app.
      </p>
      <button type="button" className="btn btn-link" onClick={onClose}>
        Keep playing as guest
      </button>
    </Sheet>
  );
}

// ------------------------------------------------------------------ Lightning invoice box

function Invoice({ topUp, onPaid, wallet }: { topUp: TopUp; onPaid: () => void; wallet: EcashWallet }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    QRCode.toDataURL(`lightning:${topUp.request}`.toUpperCase(), { margin: 1, width: 220 }).then(setQr, () => setQr(null));
  }, [topUp.request]);

  useEffect(() => {
    const id = setInterval(async () => {
      if (done.current) return;
      try {
        if (await wallet.claimTopUp(topUp)) {
          done.current = true;
          clearInterval(id);
          onPaid();
        }
      } catch {
        /* keep polling */
      }
    }, 2500);
    return () => clearInterval(id);
  }, [topUp, wallet, onPaid]);

  return (
    <div className="invoice">
      {qr ? <img src={qr} width={180} height={180} alt="Lightning invoice QR code" /> : <div className="qr-placeholder" />}
      <div className="stack">
        <span className="muted small">Pay {sats(topUp.amount)} sats with any Lightning wallet. This updates by itself once paid.</span>
        <button
          type="button"
          className="btn btn-small"
          onClick={async () => {
            await navigator.clipboard.writeText(topUp.request);
            setCopied(true);
          }}
        >
          <Icon name="copy" size={16} /> {copied ? 'Copied' : 'Copy invoice'}
        </button>
        <a className="small" href={`lightning:${topUp.request}`}>
          Open in wallet app
        </a>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ wallet

export function WalletSheet({ wallet, balance, onClose }: { wallet: EcashWallet; balance: number; onClose: () => void }) {
  const [tab, setTab] = useState<'add' | 'paste' | 'out'>('add');
  const [amount, setAmount] = useState(1000);
  const [topUp, setTopUp] = useState<TopUp | null>(null);
  const [token, setToken] = useState('');
  const [invoice, setInvoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ text: await fn() });
    } catch (err) {
      setMsg({ text: (err as Error).message, bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Your ecash" onClose={onClose}>
      <div className="balance-big mono">
        {sats(balance)} <span className="muted small">sats</span>
      </div>
      <p className="muted small">
        Held in this browser as Cashu ecash from <span className="mono">{wallet.mintUrl}</span>. Clearing site data deletes it, so keep amounts small.
      </p>
      <div className="tabs" role="tablist">
        {(
          [
            ['add', 'Add via Lightning'],
            ['paste', 'Paste token'],
            ['out', 'Cash out'],
          ] as const
        ).map(([k, label]) => (
          <button type="button" role="tab" aria-selected={tab === k} key={k} className={`tab ${tab === k ? 'is-on' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'add' &&
        (topUp ? (
          <Invoice
            topUp={topUp}
            wallet={wallet}
            onPaid={() => {
              setTopUp(null);
              setMsg({ text: `Added ${sats(topUp.amount)} sats.` });
            }}
          />
        ) : (
          <div className="stack">
            <div className="chips">
              {[100, 500, 1000, 5000].map((a) => (
                <button type="button" key={a} className={`chip ${amount === a ? 'is-on' : ''}`} onClick={() => setAmount(a)}>
                  {sats(a)}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(async () => (setTopUp(await wallet.topUp(amount)), 'Invoice ready'))}>
              Get invoice for {sats(amount)} sats
            </button>
          </div>
        ))}

      {tab === 'paste' && (
        <div className="stack">
          <label className="field-label" htmlFor="tok">
            Cashu token
          </label>
          <textarea id="tok" rows={3} value={token} onChange={(e) => setToken(e.target.value)} placeholder="cashuB…" />
          <button type="button" className="btn btn-primary" disabled={busy || !token.trim()} onClick={() => act(async () => `Received ${sats(await wallet.receive(token))} sats.`).then(() => setToken(''))}>
            Receive
          </button>
        </div>
      )}

      {tab === 'out' && (
        <div className="stack">
          <label className="field-label" htmlFor="inv">
            Lightning invoice to pay
          </label>
          <textarea id="inv" rows={3} value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="lnbc…" />
          <button type="button" className="btn btn-primary" disabled={busy || !invoice.trim()} onClick={() => act(async () => `Paid. ${sats(await wallet.payInvoice(invoice))} sats spent incl. fees.`).then(() => setInvoice(''))}>
            Pay invoice
          </button>
        </div>
      )}

      {msg && <p className={msg.bad ? 'error' : 'ok'}>{msg.text}</p>}
    </Sheet>
  );
}

// ------------------------------------------------------------------ stake

export function StakeSheet({
  code,
  stake,
  wallet,
  balance,
  onStake,
  onClose,
}: {
  code: string;
  stake: number;
  wallet: EcashWallet;
  balance: number;
  onStake: (token: string) => Promise<void>;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<'wallet' | 'token' | 'invoice'>(balance >= stake ? 'wallet' : 'invoice');
  const [token, setToken] = useState('');
  const [topUp, setTopUp] = useState<TopUp | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lock = async (getToken: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      await onStake(await getToken());
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const methods = [
    { id: 'wallet' as const, title: 'In-app balance', sub: `${sats(balance)} sats available`, disabled: balance < stake },
    { id: 'token' as const, title: 'Paste a Cashu token', sub: 'From any Cashu wallet, same mint' },
    { id: 'invoice' as const, title: 'Pay a Lightning invoice', sub: 'Any Lightning wallet' },
  ];

  return (
    <Sheet title={`Stake for room ${code}`} onClose={onClose}>
      <div className="stake-amount">
        <strong className="mono">{sats(stake)}</strong>
        <span className="muted small">sats · set by the room host</span>
      </div>
      <fieldset className="methods">
        <legend className="muted small">Pay with</legend>
        {methods.map((m) => (
          <button
            type="button"
            key={m.id}
            className={`method ${method === m.id ? 'is-on' : ''}`}
            aria-pressed={method === m.id}
            disabled={m.disabled}
            onClick={() => setMethod(m.id)}
          >
            <i className="radio" />
            <span>
              <strong>{m.title}</strong>
              <small className="muted">{m.sub}</small>
            </span>
          </button>
        ))}
      </fieldset>

      {method === 'token' && (
        <div className="stack">
          <label className="field-label" htmlFor="stake-token">
            Cashu token for exactly {sats(stake)} sats
          </label>
          <textarea id="stake-token" rows={3} value={token} onChange={(e) => setToken(e.target.value)} placeholder="cashuB…" />
        </div>
      )}
      {method === 'invoice' &&
        (topUp ? (
          <Invoice topUp={topUp} wallet={wallet} onPaid={() => void lock(() => wallet.sendToken(stake))} />
        ) : (
          <button type="button" className="btn" disabled={busy} onClick={async () => setTopUp(await wallet.topUp(stake).catch((e: Error) => (setError(e.message), null)))}>
            Get invoice
          </button>
        ))}

      <p className="muted small">
        Your stake is held by the game server at {wallet.mintUrl} until the round ends. If the room doesn't fill within 5 minutes, it comes straight back.
      </p>
      {error && <p className="error">{error}</p>}

      {method !== 'invoice' && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || (method === 'token' && !token.trim())}
          onClick={() => lock(async () => (method === 'wallet' ? wallet.sendToken(stake) : token.trim()))}
        >
          {busy ? 'Locking…' : 'Lock stake'}
        </button>
      )}
    </Sheet>
  );
}
