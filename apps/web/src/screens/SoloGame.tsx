import { useCallback, useMemo, useState } from 'react';
import {
  ROWS_PER_WORD,
  blocksUntilNextWord,
  dailyAnswer,
  dailyIndex,
  isSolved,
  isValidGuess,
  keyStates,
  score,
  type Mark,
} from '@blockword/shared';
import { Board, Keyboard, useKeyInput } from '../components/ui';
import { loadSolo, recordResult, saveSolo, type SoloSave } from '../lib/solo';

const SQUARE: Record<Mark, string> = { c: '🟧', p: '🟦', a: '⬛' };

export function SoloGame({ height, live, active, onFinished }: { height: number; live: boolean; active: boolean; onFinished?: () => void }) {
  const index = dailyIndex(height);
  const answer = dailyAnswer(index);
  const [save, setSave] = useState<SoloSave>(() => loadSolo(index));
  const [current, setCurrent] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  // A new word started while the page was open.
  if (save.index !== index) {
    const fresh = loadSolo(index);
    setSave(fresh);
    setCurrent('');
  }

  const rows = useMemo(() => save.guesses.map((word) => ({ word, marks: score(word, answer) })), [save.guesses, answer]);
  const keys = useMemo(() => keyStates(rows), [rows]);

  const flash = (msg: string, bad = false) => {
    setToast(msg);
    if (bad) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
    }
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 1800);
  };

  const onKey = useCallback(
    (key: string) => {
      if (save.done) return;
      if (key === 'DEL') return setCurrent((c) => c.slice(0, -1));
      if (key !== 'ENTER') return setCurrent((c) => (c.length < 5 ? c + key : c));
      if (current.length < 5) return flash('Not enough letters', true);
      if (!isValidGuess(current)) return flash('Not in the word list', true);
      const guesses = [...save.guesses, current];
      const won = isSolved(score(current, answer));
      const done = won || guesses.length >= ROWS_PER_WORD;
      const next = { ...save, guesses, done, won };
      setSave(next);
      saveSolo(next);
      setCurrent('');
      if (done) {
        recordResult(index, won);
        flash(won ? ['Genesis!', 'Block found!', 'Confirmed!', 'Nice mining', 'Close one', 'Phew!'][guesses.length - 1]! : answer);
        onFinished?.();
      }
    },
    [save, current, answer, index, onFinished],
  );

  useKeyInput(onKey, active && !save.done);

  const share = async () => {
    const grid = rows.map((r) => r.marks.map((m) => SQUARE[m]).join('')).join('\n');
    const text = `Blockword #${index} ${save.won ? save.guesses.length : 'X'}/6\n${grid}`;
    try {
      await navigator.clipboard.writeText(text);
      flash('Result copied');
    } catch {
      flash('Could not copy');
    }
  };

  return (
    <div className="solo">
      <div className="solo-meta">
        <span className="mono muted">
          BLOCK #{height.toLocaleString('en-US')}
          {live ? '' : ' (est.)'} · NEXT WORD IN ~{blocksUntilNextWord(height)} BLOCKS
        </span>
        <span className="muted small">
          {save.done ? (save.won ? `Solved in ${save.guesses.length}` : `The word was ${answer}`) : `Attempt ${save.guesses.length + 1} of 6`}
        </span>
      </div>

      <div className="board-wrap">
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
        <Board rows={rows} current={save.done ? null : current} shake={shake} />
      </div>

      <Legend />

      {save.done ? (
        <div className="solo-done">
          <button type="button" className="btn btn-primary" onClick={share}>
            Share result
          </button>
          <span className="muted small">Come back in ~{blocksUntilNextWord(height)} blocks for the next word.</span>
        </div>
      ) : (
        <Keyboard states={keys} onKey={onKey} />
      )}
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend" aria-hidden="true">
      <span>
        <i className="sw sw-c" />
        Right spot
      </span>
      <span>
        <i className="sw sw-p" />
        In the word
      </span>
      <span>
        <i className="sw sw-a" />
        Not in it
      </span>
    </div>
  );
}
