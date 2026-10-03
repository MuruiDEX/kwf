import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLang } from '../i18n';
import { ApiError, api, errMsg, pageItems, useLiveSSE } from '../lib/api';
import { useLiveState, useTournamentsLive, useMyAssignments } from '../lib/queries';
import type { FinishResult, LiveEvent, LiveFight, MyAssignment, TimerState, Tournament } from '../types/api';

/** Partial timer view: SSE events carry only changed fields. */
type TimerView = {
  action?: 'running' | 'paused' | 'idle' | string;
  ends_at?: number | null;
  remaining_sec?: number;
  duration_sec?: number;
};

function fmt(sec: number) {
  const m = Math.floor(sec / 60), s = Math.max(sec % 60, 0);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// TV Board: huge type, fullscreen, minimal elements (§13), realtime via SSE
export function TvBoard() {
  const { t } = useLang();
  const { id } = useParams();
  const { data } = useLiveState(id);
  const [timer, setTimer] = useState<TimerView | null>(null);
  const [lastFight, setLastFight] = useState<Extract<LiveEvent, { type: 'fight_finished' }> | null>(null);
  const [sseUp, setSseUp] = useState(true);
  useLiveSSE(id ?? null, ev => {
    if (ev.type === 'timer') setTimer(ev);
    if (ev.type === 'fight_finished') setLastFight(ev);
  }, true, setSseUp);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const remain = timer?.action === 'running' && timer.ends_at
    ? Math.max(Math.round(timer.ends_at - now / 1000), 0)
    : timer?.remaining_sec ?? timer?.duration_sec ?? null;
  const cur = data?.live?.[0];
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center p-8" style={{ background: '#05080D', color: '#F8FAFC', borderTop: '3px solid #C9A227' }}>
      <div className="text-xs font-bold tracking-[.3em]" style={{ color: '#C9A227' }}>{t('tv.tatami')}</div>
      {!sseUp && <div className="text-xs font-bold mt-2" style={{ color: '#94A3B8' }}>{t('lv.reconnecting')}</div>}
      {remain !== null && <div className="display font-semibold tabular-nums mt-4" style={{ fontSize: 'clamp(72px, 16vw, 170px)', lineHeight: 1 }} aria-label={t('ref.dur')}>{fmt(remain)}</div>}
      {cur ? <div className="display text-3xl md:text-5xl font-medium mt-5">{cur.a_name ?? `#${cur.a}`} <span style={{ color: '#C9A227' }}>—</span> {cur.b_name ?? `#${cur.b}`}</div>
        : lastFight ? <div className="display text-2xl md:text-4xl font-medium mt-5">{t('lv.fight')} {lastFight.match_id} → 🏆 {lastFight.winner}</div>
        : <div className="display text-4xl md:text-6xl font-medium mt-5">{t('tv.wait')}</div>}
      <button className="mt-8 px-4 py-2 text-sm rounded-lg border" style={{ borderColor: '#1E293B', color: '#94A3B8' }} onClick={() => { document.documentElement.requestFullscreen().catch(() => {}); }}>{t('tv.fs')}</button>
    </div>
  );
}

// Referee mode: big buttons, minimal text (§14) — timer + score + finish wired to API
export function Referee() {
  const { t } = useLang();
  const qc = useQueryClient();
  const [tid, setTid] = useState('1');
  const [mid, setMid] = useState('');
  const [dur, setDur] = useState(180);
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [winner, setWinner] = useState<'A' | 'B' | null>(null);
  const [timer, setTimer] = useState<TimerView | null>(null);
  const [msg, setMsg] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasMid = mid.trim().length > 0;
  // Wave 2: referee queue — live tournaments + their fights with real names.
  // Tapping a fight selects it (no manual ID needed); manual inputs stay as
  // fallback (E2E and edge cases). Permissions unchanged: finish/timer guards
  // still enforced server-side per match.
  const { data: liveTournamentsRaw } = useTournamentsLive();
  const liveTournaments: Tournament[] = pageItems(liveTournamentsRaw);
  const { data: liveSnap } = useLiveState(tid || undefined);
  const queue: LiveFight[] = [...(liveSnap?.live ?? []), ...(liveSnap?.queue ?? [])];
  const cur = queue.find((x) => String(x.id) === mid.trim());
  const pick = (id: number) => { setMid(String(id)); setWinner(null); setConfirming(false); setMsg(''); };
  // Wave 3: my tatami assignments — filter the queue to assigned tatamis.
  const { data: myAssign } = useMyAssignments();
  const [onlyMine, setOnlyMine] = useState(false);
  const myTatamis: number[] = (myAssign ?? []).map((a) => a.tatami_id);
  const shown = onlyMine && myTatamis.length ? queue.filter((f) => f.tatami_id != null && myTatamis.includes(f.tatami_id)) : queue;
  useLiveSSE(tid || null, ev => { if (ev.type === 'timer' && String(ev.match_id) === mid) setTimer(ev); }, !!tid);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const tt = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(tt); }, []);
  const remain = timer?.action === 'running' && timer.ends_at
    ? Math.max(Math.round(timer.ends_at - now / 1000), 0)
    : timer?.remaining_sec ?? timer?.duration_sec ?? dur;
  const call = async (path: string, body: Record<string, string | number>, ok: string) => {
    if (!hasMid) { setMsg(`${t('common.err')}: ` + t('ref.noMid')); return; }
    try {
      const r = await api<TimerState>(path, { method: 'POST', body: JSON.stringify(body) });
      if (body.action) setTimer(r);
      setMsg('✓ ' + ok);
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
  };
  const finish = async () => {
    if (!hasMid) { setMsg(`${t('common.err')}: ` + t('ref.noMid')); return; }
    if (!winner) { setMsg(`${t('common.err')}: ` + t('ref.wA') + ' / ' + t('ref.wB')); return; }
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 4000);
      return;
    }
    setBusy(true);
    try {
      const live = await api<{ live: LiveFight[]; queue: LiveFight[] }>(`/api/tournaments/${tid}/live`);
      const m = [...live.live, ...live.queue].find((x) => String(x.id) === mid);
      if (!m) { setMsg(`${t('common.err')}: ` + t('ref.noFight')); return; }
      const wid = winner === 'A' ? m.a : m.b;
      const r = await api<FinishResult>(`/api/tournaments/matches/${mid}/finish`, { method: 'POST', body: JSON.stringify({ winner_id: wid, score_a: scoreA, score_b: scoreB }) });
      // Wave 7: refresh the queue snapshot (the finished fight leaves it).
      qc.invalidateQueries({ queryKey: ['live', String(tid)] });
      // P0 correction semantics surfaced, never a stack trace.
      setMsg(r.outcome === 'repeated' ? t('ref.repeated') : r.outcome === 'corrected' ? t('ref.corrected') : t('ref.done'));
      setConfirming(false);
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 409) setMsg(t('ref.conflict'));
      else if (e instanceof ApiError && (e.status === 403 || e.status === 404)) setMsg(`${t('common.err')}: ` + t('ref.noFight'));
      else setMsg(`${t('common.err')}: ` + errMsg(e));
    }
    setBusy(false);
  };
  const big = 'rounded-2xl py-8 text-3xl font-black card w-full';
  return (
    <div className="space-y-4 max-w-lg mx-auto fade-up">
      <div><span className="eyebrow">{t('ref.eyebrow')}</span>
        <h1 className="display text-3xl font-semibold mt-1">{t('ref.title')}</h1></div>
      {!!(myAssign ?? []).length && (
        <div className="card p-3 space-y-1 text-sm" aria-label={t('ref.myAssign')}>
          <div className="text-xs font-extrabold uppercase tracking-[.12em]" style={{ color: 'var(--muted)' }}>{t('ref.myAssign')}</div>
          {(myAssign ?? []).map((a: MyAssignment) => (
            <button key={a.tatami_id} className="block w-full text-left font-semibold"
                    onClick={() => setTid(String(a.tournament_id))}>
              {a.tournament} · {a.tatami} · {t('lv.next')}: {a.fights.length}
            </button>
          ))}
        </div>
      )}
      {!!liveTournaments.length && (
        <select aria-label={t('ref.pickT')} className="field w-full" value={tid}
                onChange={(e) => setTid(e.target.value)}>
          {!liveTournaments.some((x) => String(x.id) === tid) && <option value={tid}>#{tid}</option>}
          {liveTournaments.map((x) => <option key={x.id} value={String(x.id)}>#{x.id} · {x.name}</option>)}
        </select>
      )}
      {!!queue.length && (
        <div className="card p-3 space-y-1" aria-label={t('ref.queue')}>
          <div className="flex items-center gap-2">
            <div className="text-xs font-extrabold uppercase tracking-[.12em] flex-1" style={{ color: 'var(--muted)' }}>{t('ref.queue')}</div>
            {!!myTatamis.length && (
              <label className="text-xs font-bold flex items-center gap-1">
                <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
                {t('ref.onlyMine')}
              </label>
            )}
          </div>
          {shown.slice(0, 8).map((f) => (
            <button key={f.id} onClick={() => pick(f.id)} aria-pressed={String(f.id) === mid.trim()}
                    className="flex w-full items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-semibold text-left"
                    style={String(f.id) === mid.trim() ? { background: 'var(--accent-soft)' } : {}}>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>#{f.id}{f.tatami_id ? ` · T${f.tatami_id}` : ''}</span>
              <span className="truncate">{f.a_name ?? `#${f.a}`} — {f.b_name ?? `#${f.b}`}</span>
              {f.status === 'live' && <span className="badge badge-live ml-auto">live</span>}
            </button>
          ))}
        </div>
      )}
      {cur && (
        <div className="text-sm font-bold" aria-live="polite">
          #{cur.id}: {cur.a_name ?? 'Aka'} — {cur.b_name ?? 'Shiro'}
        </div>
      )}
      <div className="flex gap-2">
        <input aria-label={t('ref.tid')} className="field w-24" value={tid} onChange={e => setTid(e.target.value)} inputMode="numeric" />
        <input aria-label={t('ref.mid')} className="field flex-1" placeholder={t('ref.mid')} value={mid} onChange={e => setMid(e.target.value)} inputMode="numeric" />
        <input aria-label={t('ref.dur')} className="field w-24" type="number" value={dur} onChange={e => setDur(Number(e.target.value))} />
      </div>
      <div className="card p-5 text-center" style={timer?.action === 'running' ? { borderColor: 'var(--accent)' } : {}}>
        <div className="display font-semibold tabular-nums" style={{ fontSize: 64, lineHeight: 1 }} aria-label={t('ref.dur')}>{fmt(remain)}</div>
        <div className="text-xs font-bold uppercase tracking-[.14em] mt-1" style={{ color: 'var(--muted)' }}>
          {timer?.action === 'running' ? t('ref.running') : timer?.action === 'paused' ? t('ref.paused') : t('ref.idle')}
        </div>
        <div className="flex gap-2 mt-4">
          <button className="btn-primary flex-1 justify-center !py-3" onClick={() => call(`/api/tournaments/matches/${mid}/timer`, { action: 'start', duration_sec: dur }, t('ref.start'))}>{t('ref.start')}</button>
          <button className="btn-ghost flex-1 justify-center !py-3" onClick={() => call(`/api/tournaments/matches/${mid}/timer`, { action: 'pause', duration_sec: dur }, t('ref.paused'))}>{t('ref.pause')}</button>
          <button className="btn-ghost flex-1 justify-center !py-3" onClick={() => call(`/api/tournaments/matches/${mid}/timer`, { action: 'reset', duration_sec: dur }, t('ref.reset'))}>{t('ref.reset')}</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-6 text-center"><div className="font-black text-2xl">Aka</div><div className="text-5xl font-black">{scoreA}</div>
          <div className="flex gap-2">
            <button className={big} onClick={() => setScoreA(s => s + 1)} aria-label="Aka +">+</button>
            <button className="card px-4 font-black text-2xl" onClick={() => setScoreA(s => Math.max(0, s - 1))} aria-label="Aka −">−</button>
          </div></div>
        <div className="card p-6 text-center"><div className="font-black text-2xl">Shiro</div><div className="text-5xl font-black">{scoreB}</div>
          <div className="flex gap-2">
            <button className={big} onClick={() => setScoreB(s => s + 1)} aria-label="Shiro +">+</button>
            <button className="card px-4 font-black text-2xl" onClick={() => setScoreB(s => Math.max(0, s - 1))} aria-label="Shiro −">−</button>
          </div></div>
      </div>
      <div className="flex gap-2 text-sm">
        <button className="card px-3 py-2 flex-1 font-bold" style={winner === 'A' ? { borderColor: 'var(--accent)' } : {}} onClick={() => { setWinner('A'); setConfirming(false); }}>{t('ref.wA')}</button>
        <button className="card px-3 py-2 flex-1 font-bold" style={winner === 'B' ? { borderColor: 'var(--accent)' } : {}} onClick={() => { setWinner('B'); setConfirming(false); }}>{t('ref.wB')}</button>
      </div>
      <button className="btn-primary w-full py-4 text-lg justify-center" onClick={finish} disabled={busy || !hasMid}>
        {confirming ? `⚠ ${t('ref.finish')}?` : t('ref.finish')}</button>
      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}
