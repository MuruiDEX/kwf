import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Scale, Tv } from 'lucide-react';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { ApiError, api, errMsg, pageItems, useLiveSSE } from '../lib/api';
import { useLiveState, useTournamentsLive, useMyAssignments, useAudit } from '../lib/queries';
import type { FinishResult, LiveFight, MyAssignment, TimerState } from '../types/api';
import { Badge } from '../components/ui/core';
import { PageHeader, PageWrap, RoleTabs, SectionCard } from '../components/ui/role';

function fmt(sec: number) {
  const m = Math.floor(sec / 60), s = Math.max(sec % 60, 0);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const TABS = [
  { id: 'home', labelKey: 'rx.home' },
  { id: 'assign', labelKey: 'rx.assign' },
  { id: 'queue', labelKey: 'rx.queue' },
  { id: 'weighin', labelKey: 'tab.weighin' },
  { id: 'history', labelKey: 'rx.history' },
];

/** Match control console (high density, large controls, wide):
 *  now-strip → assignments → queue + control side by side. */
export function RefereeHome() {
  const { t } = useLang();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'home';
  const setTab = (id: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; }, { replace: true });

  const { data: myAssign } = useMyAssignments();
  const { data: liveTournamentsRaw } = useTournamentsLive();
  const liveTournaments = pageItems(liveTournamentsRaw);
  const [tid, setTid] = useState<string>(() => sp.get('tid') ?? '');
  // Default tid from first assignment or first live tournament (no manual '1').
  useEffect(() => {
    if (tid) return;
    const fromAssign = (myAssign ?? [])[0]?.tournament_id;
    if (fromAssign) { setTid(String(fromAssign)); return; }
    const first = liveTournaments[0];
    if (first) setTid(String(first.id));
  }, [tid, myAssign, liveTournaments]);

  const { data: liveSnap } = useLiveState(tid || undefined);
  const queue: LiveFight[] = useMemo(() => [...(liveSnap?.live ?? []), ...(liveSnap?.queue ?? [])], [liveSnap]);
  const myTatamis: number[] = useMemo(() => (myAssign ?? []).map((a) => a.tatami_id), [myAssign]);
  // onlyMine defaults ON when assignments exist (natural default behavior).
  const [onlyMine, setOnlyMine] = useState(true);
  const shown = onlyMine && myTatamis.length ? queue.filter((f) => f.tatami_id != null && myTatamis.includes(f.tatami_id)) : queue;

  const [mid, setMid] = useState('');
  const [dur, setDur] = useState(180);
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [winner, setWinner] = useState<'A' | 'B' | null>(null);
  const [timer, setTimer] = useState<{ action?: string; ends_at?: number | null; remaining_sec?: number; duration_sec?: number } | null>(null);
  const [msg, setMsg] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useLiveSSE(tid || null, (ev) => { if (ev.type === 'timer' && String(ev.match_id) === mid) setTimer(ev); }, !!tid && !!mid);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const tt = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(tt); }, []);
  const remain = timer?.action === 'running' && timer.ends_at
    ? Math.max(Math.round(timer.ends_at - now / 1000), 0)
    : timer?.remaining_sec ?? timer?.duration_sec ?? dur;
  const cur = queue.find((x) => String(x.id) === mid.trim());
  const focus = cur ?? liveSnap?.live?.[0] ?? queue[0] ?? null;
  const pick = (id: number) => { setMid(String(id)); setWinner(null); setConfirming(false); setMsg(''); setTab('queue'); };

  const call = async (path: string, body: Record<string, string | number>, ok: string) => {
    if (!mid.trim()) { setMsg(`${t('common.err')}: ` + t('ref.noMid')); return; }
    try {
      const r = await api<TimerState>(path, { method: 'POST', body: JSON.stringify(body) });
      if (body.action) setTimer(r);
      setMsg('✓ ' + ok);
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
  };
  const finish = async () => {
    if (!mid.trim()) { setMsg(`${t('common.err')}: ` + t('ref.noMid')); return; }
    if (!winner) { setMsg(`${t('common.err')}: ` + t('ref.wA') + ' / ' + t('ref.wB')); return; }
    if (!confirming) { setConfirming(true); setTimeout(() => setConfirming(false), 4000); return; }
    setBusy(true);
    try {
      const live = await api<{ live: LiveFight[]; queue: LiveFight[] }>(`/api/tournaments/${tid}/live`);
      const m = [...live.live, ...live.queue].find((x) => String(x.id) === mid);
      if (!m) { setMsg(`${t('common.err')}: ` + t('ref.noFight')); return; }
      const wid = winner === 'A' ? m.a : m.b;
      const r = await api<FinishResult>(`/api/tournaments/matches/${mid}/finish`, { method: 'POST', body: JSON.stringify({ winner_id: wid, score_a: scoreA, score_b: scoreB }) });
      qc.invalidateQueries({ queryKey: ['live', String(tid)] });
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

  const { data: auditRaw } = useAudit();
  const history = pageItems(auditRaw).filter((a) => /fight|timer|weigh|checkin/i.test(`${a.action} ${a.entity}`)).slice(0, 12);
  const canWeigh = can('tournaments.manage') || can('matches.manage');

  return (
    <PageWrap width="wide" dense>
      <PageHeader eyebrowKey="ref.eyebrow" titleKey="ref.title" sub={(myAssign ?? []).length ? `${t('ref.myAssign')}: ${(myAssign ?? []).length}` : undefined} />

      {/* Now-strip: the mat, not a marketing hero. One glance: where + what. */}
      <div className="card p-4" aria-live="polite" style={focus?.status === 'live' ? { borderColor: 'var(--live)' } : {}}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="eyebrow">{t('ref.eyebrow')}</span>
          {focus?.status === 'live' && <span className="badge badge-live">{t('lv.live')}</span>}
          {myTatamis.length > 0 && <Badge tone="gold">Tatami: {myTatamis.join(', ')}</Badge>}
          <span className="ml-auto flex gap-2">
            {!!queue.length && !cur && (
              <button className="btn-primary text-xs !py-1.5" onClick={() => queue[0] && pick(queue[0].id)}>{t('lv.next')} →</button>
            )}
            {tid && <Link to={`/tv/${tid}`} className="btn-ghost text-xs !py-1.5"><Tv size={14} /> {t('lv.tv')}</Link>}
          </span>
        </div>
        {focus ? (
          <div className="display text-xl md:text-2xl font-semibold mt-2 leading-tight">
            #{focus.id}{focus.tatami_id ? ` · T${focus.tatami_id}` : ''} — {focus.a_name ?? 'Aka'} <span style={{ color: 'var(--accent)' }}>vs</span> {focus.b_name ?? 'Shiro'}
          </div>
        ) : (
          <div className="display text-xl font-semibold mt-2" style={{ color: 'var(--muted)' }}>{t('tv.wait')}</div>
        )}
      </div>

      <RoleTabs tabs={TABS} active={tab} onChange={setTab} />

      {(tab === 'home' || tab === 'assign') && (
        <SectionCard titleKey="ref.myAssign" dense>
          {!(myAssign ?? []).length ? <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('ref.pickT')}: {liveTournaments.map((x) => x.name).join(' · ') || '—'}</div>
            : (
              <div className="grid sm:grid-cols-2 gap-2">
                {(myAssign ?? []).map((a: MyAssignment) => (
                  <button key={a.tatami_id} className="block w-full text-left font-semibold card card-hover p-3 text-sm" onClick={() => { setTid(String(a.tournament_id)); setTab('queue'); }}>
                    <span className="block text-xs font-bold" style={{ color: 'var(--muted)' }}>{a.tournament}</span>
                    <span className="block font-extrabold">{a.tatami} · {t('lv.next')}: {a.fights.length}</span>
                  </button>
                ))}
              </div>
            )}
          {!!liveTournaments.length && (
            <select aria-label={t('ref.pickT')} className="field w-full mt-2" value={tid} onChange={(e) => setTid(e.target.value)}>
              {!liveTournaments.some((x) => String(x.id) === tid) && tid && <option value={tid}>#{tid}</option>}
              {liveTournaments.map((x) => <option key={x.id} value={String(x.id)}>#{x.id} · {x.name}</option>)}
            </select>
          )}
        </SectionCard>
      )}

      {(tab === 'home' || tab === 'queue') && (
        <div className="grid lg:grid-cols-2 gap-3 items-start">
          <SectionCard titleKey="ref.queue" dense action={!!myTatamis.length ? (
            <label className="text-xs font-bold flex items-center gap-1"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />{t('ref.onlyMine')}</label>
          ) : undefined}>
            <div>
              {!shown.length ? <div className="text-sm pt-1" style={{ color: 'var(--muted)' }}>{t('lv.empty')}</div>
                : shown.slice(0, 10).map((f) => (
                  <button key={f.id} onClick={() => { setMid(String(f.id)); setWinner(null); setConfirming(false); setMsg(''); }}
                    aria-pressed={String(f.id) === mid.trim()}
                    className="flex w-full items-center gap-2 px-2 py-2 rounded-xl text-sm font-semibold text-left min-h-[48px] mb-1"
                    style={String(f.id) === mid.trim() ? { background: 'var(--accent-soft)', border: '1px solid var(--accent)' } : { border: '1px solid var(--border)' }}>
                    <span className="text-xs flex-none tabular-nums" style={{ color: 'var(--muted)' }}>#{f.id}{f.tatami_id ? ` · T${f.tatami_id}` : ''}</span>
                    <span className="truncate flex-1">{f.a_name ?? `#${f.a}`} — {f.b_name ?? `#${f.b}`}</span>
                    {f.status === 'live' && <span className="badge badge-live ml-auto flex-none">live</span>}
                  </button>
                ))}
              {cur && <div className="text-sm font-bold pt-1" aria-live="polite">#{cur.id}: {cur.a_name ?? 'Aka'} — {cur.b_name ?? 'Shiro'}</div>}
            </div>
          </SectionCard>

          <div className="space-y-3 min-w-0">
            <div className="card p-5 text-center" style={timer?.action === 'running' ? { borderColor: 'var(--accent)' } : {}}>
              <div className="display font-semibold tabular-nums" style={{ fontSize: 64, lineHeight: 1 }} aria-label={t('ref.dur')}>{fmt(remain)}</div>
              <div className="text-xs font-bold uppercase tracking-[.14em] mt-1" style={{ color: 'var(--muted)' }}>
                {timer?.action === 'running' ? t('ref.running') : timer?.action === 'paused' ? t('ref.paused') : t('ref.idle')}
              </div>
              <div className="flex gap-2 mt-4">
                <button className="btn-primary flex-1 justify-center !py-3 min-h-[48px]" onClick={() => call(`/api/tournaments/matches/${mid}/timer`, { action: 'start', duration_sec: dur }, t('ref.start'))}>{t('ref.start')}</button>
                <button className="btn-ghost flex-1 justify-center !py-3 min-h-[48px]" onClick={() => call(`/api/tournaments/matches/${mid}/timer`, { action: 'pause', duration_sec: dur }, t('ref.paused'))}>{t('ref.pause')}</button>
                <button className="btn-ghost flex-1 justify-center !py-3 min-h-[48px]" onClick={() => call(`/api/tournaments/matches/${mid}/timer`, { action: 'reset', duration_sec: dur }, t('ref.reset'))}>{t('ref.reset')}</button>
              </div>
              <div className="flex gap-2 mt-2">
                <input aria-label={t('ref.tid')} className="field w-24" value={tid} onChange={(e) => setTid(e.target.value)} inputMode="numeric" />
                <input aria-label={t('ref.mid')} className="field flex-1" placeholder={`${t('ref.mid')} (auto)`} value={mid} onChange={(e) => setMid(e.target.value)} inputMode="numeric" />
                <input aria-label={t('ref.dur')} className="field w-24" type="number" value={dur} onChange={(e) => setDur(Number(e.target.value))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-5 text-center"><div className="font-black text-xl">Aka</div><div className="text-4xl font-black tabular-nums">{scoreA}</div>
                <div className="flex gap-2 mt-1"><button className={big} onClick={() => setScoreA((s) => s + 1)} aria-label="Aka +">+</button>
                <button className="card px-4 font-black text-2xl min-h-[48px]" onClick={() => setScoreA((s) => Math.max(0, s - 1))} aria-label="Aka −">−</button></div></div>
              <div className="card p-5 text-center"><div className="font-black text-xl">Shiro</div><div className="text-4xl font-black tabular-nums">{scoreB}</div>
                <div className="flex gap-2 mt-1"><button className={big} onClick={() => setScoreB((s) => s + 1)} aria-label="Shiro +">+</button>
                <button className="card px-4 font-black text-2xl min-h-[48px]" onClick={() => setScoreB((s) => Math.max(0, s - 1))} aria-label="Shiro −">−</button></div></div>
            </div>
            <div className="flex gap-2 text-sm">
              <button className="card px-3 py-3 flex-1 font-bold min-h-[48px]" style={winner === 'A' ? { borderColor: 'var(--accent)' } : {}} onClick={() => { setWinner('A'); setConfirming(false); }}>{t('ref.wA')}</button>
              <button className="card px-3 py-3 flex-1 font-bold min-h-[48px]" style={winner === 'B' ? { borderColor: 'var(--accent)' } : {}} onClick={() => { setWinner('B'); setConfirming(false); }}>{t('ref.wB')}</button>
            </div>
            <button className="btn-primary w-full py-4 text-lg justify-center min-h-[56px]" onClick={finish} disabled={busy || !mid.trim()}>
              {confirming ? `⚠ ${t('ref.finish')}?` : t('ref.finish')}</button>
            {msg && <div className="text-sm">{msg}</div>}
          </div>
        </div>
      )}

      {tab === 'weighin' && (
        <SectionCard titleKey="tab.weighin" action={tid ? <Link to={`/tournaments/${tid}?tab=weighin`} className="btn-ghost text-xs !py-1.5">{t('nav.open')} →</Link> : undefined}>
          {!canWeigh ? <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('rx.noPermHint')}</div>
            : !tid ? <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('ref.pickT')}</div>
            : <Link to={`/tournaments/${tid}?tab=weighin`} className="btn-primary text-sm justify-center w-full"><Scale size={15} /> {t('tab.weighin')} →</Link>}
          <div className="text-xs" style={{ color: 'var(--muted)' }}>{t('w.searchPh')} · {t('w.problems')}</div>
        </SectionCard>
      )}

      {tab === 'history' && (
        <SectionCard titleKey="rx.history">
          {!history.length ? <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('adm.empty')}</div>
            : history.map((a) => (
              <div key={a.id} className="text-sm py-1 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <b>{a.action}</b> <span style={{ color: 'var(--muted)' }}>{a.entity} #{a.entity_id ?? '—'} · {a.at}</span>
              </div>
            ))}
        </SectionCard>
      )}
    </PageWrap>
  );
}
