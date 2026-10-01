import { useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { CalendarDays, MapPin, Users, Layers, Clock, CheckCircle2, AlertTriangle, ArrowRight, Tv, Swords, Trophy } from 'lucide-react';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { pageItems, useLiveSSE, errMsg } from '../lib/api';
import { Badge, EmptyState, Skeleton } from '../components/ui/core';
import { ExportBar, Results } from './Documents';
import { STATUS_TONE, FLOW } from '../components/ui/tournament';
import { useTournament, useRegs, useBrackets, useValidation, useGenBrackets, useGenSchedule, useStatusChange, useCheckin, useWeighIn, useLiveState } from '../lib/queries';
import type { Bracket, LiveEvent, Registration, TournamentDetail as TournamentDetailT, TournamentStatus, ValidationItem } from '../types/api';

interface ImportSummary {
  summary: string;
  found?: number;
  imported?: number;
  errors: { row: number; error: string }[];
}

const TABS = ['overview', 'participants', 'brackets', 'schedule', 'live', 'results', 'weighin'] as const;

export function TournamentDetail() {
  const { t, lang } = useLang();
  const TAB_RU: Record<string, string> = {
    overview: t('tab.overview'), participants: t('tab.participants'), brackets: t('tab.brackets'),
    schedule: t('tab.schedule'), live: t('tab.live'), results: t('tab.results'), weighin: t('tab.weighin'),
  };
  const FLOW_RU: Record<string, string> = {
    upcoming: t('d.flow1'), registration: t('d.flow2'), live: t('d.flow3'), finished: t('d.flow4'),
  };
  const { id } = useParams();
  const { can } = useAuth();
  // P1: UI hint only (backend enforces). Use permissions, not raw role==,
  // so granted users (e.g. coach with tournaments.manage) see the buttons
  // and foreign organizers don't get a misleading affordance (they'd 403).
  const canManage = can('tournaments.manage');
  const [sp, setSp] = useSearchParams();
  const rawTab = sp.get('tab');
  const tabParam = rawTab && (TABS as readonly string[]).includes(rawTab) ? (rawTab as (typeof TABS)[number]) : 'overview';
  const setTab = (x: typeof TABS[number]) => setSp(prev => { const p = new URLSearchParams(prev); p.set('tab', x); return p; }, { replace: true });
  const tab = tabParam;
  const qc = useQueryClient();
  const { data: tt, isLoading: ttLoading, isError: ttError, refetch: ttRefetch } = useTournament(id);
  const { data: regsRaw } = useRegs(id, { enabled: !!id && (tab === 'participants' || tab === 'weighin') });
  const regs: Registration[] = pageItems(regsRaw);
  const { data: brackets } = useBrackets(id, { enabled: !!id && (tab === 'brackets' || tab === 'overview' || tab === 'schedule') });
  const { data: validation } = useValidation(id, lang, { enabled: !!id && tab === 'overview' });
  const genB = useGenBrackets(id ?? '');
  const genS = useGenSchedule(id ?? '');
  const statusChange = useStatusChange(id ?? '');
  const [flowMsg, setFlowMsg] = useState('');
  const advance = (status: string) => {
    setFlowMsg('');
    statusChange.mutate(status as TournamentStatus, { onError: (e: unknown) => setFlowMsg(errMsg(e)) });
  };
  const NEXT: Record<string, { to: string; label: string }> = {
    upcoming: { to: 'registration', label: t('ov.toReg') },
    registration: { to: 'live', label: t('ov.toLive') },
    live: { to: 'finished', label: t('ov.toFin') },
  };
  // realtime: single shared SSE hook, only on live tab
  const [liveEvents, setLiveEvents] = useState<Extract<LiveEvent, { type: 'fight_finished' }>[]>([]);
  const [sseUp, setSseUp] = useState(true);
  const { data: liveSnap } = useLiveState(tab === 'live' ? id : undefined);
  useLiveSSE(id ?? null, e => {
    if (e.type === 'fight_finished') {
      setLiveEvents(p => [...p.slice(-19), e]);
      qc.invalidateQueries({ queryKey: ['live', String(id)] });
    }
  }, tab === 'live', setSseUp);
  if (ttLoading) return <Skeleton className="h-60" />;
  if (ttError || !tt) return (
    <div className="card p-8 text-center space-y-2 fade-up">
      <div className="font-bold">{t('common.err')}</div>
      <button className="btn-ghost text-sm !py-2" onClick={() => ttRefetch()}>{t('common.retry')}</button>
    </div>
  );
  const flowIdx = FLOW.indexOf(tt.status);
  const checksOk = validation?.filter((v: ValidationItem) => v.ok).length ?? 0;
  return (
    <div className="space-y-5 fade-up">
      <div className="t-head">
        <div className="t-head-top" />
        <div className="p-5 md:p-7">
          <Link to="/tournaments" className="text-[13px] font-semibold" style={{ color: 'var(--muted)' }}>{t('d.back')}</Link>
          <div className="flex flex-wrap items-center gap-3 mt-1.5">
            <h1 className="display text-2xl md:text-[34px] font-semibold">{tt.name}</h1>
            <Badge tone={STATUS_TONE[tt.status] ?? 'gray'}>{tt.status}</Badge>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
            <span className="chip"><CalendarDays size={14} />{tt.start_date}</span>
            <span className="chip"><MapPin size={14} />{tt.city}{tt.country ? `, ${tt.country}` : ''}</span>
            <span className="chip"><Users size={14} />{tt.participants}</span>
            <span className="chip"><Layers size={14} />{tt.categories?.length ?? 0} {t('d.cats')}</span>
          </div>
          <div className="flow mt-4" aria-label={tt.name}>
            {FLOW.map((s, i) => (
              <span key={s} className="flex items-center">
                {i > 0 && <span className={`flow-line${i <= flowIdx ? ' done' : ''}`} />}
                <span className={`flow-step${i < flowIdx ? ' done' : ''}${i === flowIdx ? ' now' : ''}`}>
                  <span className="flow-dot">{i < flowIdx ? '✓' : i + 1}</span>{FLOW_RU[s]}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label={tt.name}>
        {TABS.map(x => <button key={x} role="tab" className="tab" aria-selected={tab === x} onClick={() => setTab(x)}>{TAB_RU[x]}</button>)}
      </div>
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { icon: Users, label: t('ov.participants'), value: tt.participants },
              { icon: Layers, label: t('ov.categories'), value: tt.categories?.length ?? 0 },
              { icon: Swords, label: t('ov.brackets'), value: brackets?.length ?? 0 },
              { icon: CheckCircle2, label: t('ov.checks'), value: `${checksOk}/${validation?.length ?? 0}` },
            ].map(s => (
              <div key={s.label} className="card p-4">
                <s.icon size={18} style={{ color: 'var(--accent)' }} />
                <div className="display text-[26px] font-semibold mt-1.5">{s.value}</div>
                <div className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{s.label}</div>
              </div>
            ))}
          </div>
          <Readiness tt={tt} validation={validation} canManage={canManage} onTab={setTab} />
          {canManage && (
          <div className="flex gap-2.5 flex-wrap">
            <button className="btn-primary text-sm" onClick={() => genB.mutate()} disabled={genB.isPending}>{genB.isPending ? '…' : t('ov.genB')}</button>
            <button className="btn-ghost text-sm !py-2.5" onClick={() => genS.mutate()} disabled={genS.isPending}>{genS.isPending ? '…' : t('ov.genS')}</button>
            {NEXT[tt.status] && <button className="btn-ghost text-sm !py-2.5" style={{ borderColor: 'var(--accent)' }} onClick={() => advance(NEXT[tt.status].to)}>{NEXT[tt.status].label} <ArrowRight size={15} /></button>}
          </div>
          )}
          {flowMsg && <div className="card p-3 text-sm">{flowMsg}</div>}
          {genB.isError || genS.isError ? <div className="card p-3 text-sm">{t('ov.genErr')}</div> : null}
        </div>
      )}
      {tab === 'participants' && <Participants tid={id!} />}
      {tab === 'brackets' && <BracketView brackets={brackets} />}
      {tab === 'schedule' && <BracketView brackets={brackets} showSchedule />}
      {tab === 'live' && (
        <div className="space-y-3">
          <div className="card p-5">
            <div className="flex items-center gap-2">
              <span className="eyebrow">{t('lv.eyebrow')}</span>
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--muted)' }}>
                <span className="pulse-dot" style={sseUp ? {} : { background: 'var(--warn)' }} />
                {sseUp ? t('lv.live') : t('lv.reconnecting')}
              </span>
            </div>
            {!liveSnap ? <Skeleton className="h-16 mt-3" /> : (
              <div className="mt-3 space-y-2">
                {liveSnap.live.length === 0 && liveSnap.queue.length === 0 && (
                  <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('lv.empty')}</div>
                )}
                {liveSnap.live.slice(0, 3).map(m => (
                  <div key={m.id} className="flex items-center gap-2 text-sm font-bold">
                    <span className="badge badge-live">{t('lv.current')}</span>
                    <span className="truncate">{m.a_name ?? `#${m.a}`} — {m.b_name ?? `#${m.b}`}</span>
                    {m.tatami_id && <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>T{m.tatami_id}</span>}
                  </div>
                ))}
                {liveSnap.queue.slice(0, 5).map(m => (
                  <div key={m.id} className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
                    <span className="badge">{t('lv.next')}</span>
                    <span className="truncate">{m.a_name ?? `#${m.a}`} — {m.b_name ?? `#${m.b}`}</span>
                    {m.tatami_id && <span className="text-xs">T{m.tatami_id}</span>}
                  </div>
                ))}
              </div>
            )}
            <Link to={`/tv/${id}`} className="btn-primary text-sm inline-flex mt-4"><Tv size={15} /> {t('lv.tv')}</Link>
          </div>
          {!!liveEvents.length && (
            <div className="card p-5 text-sm space-y-1" style={{ color: 'var(--muted)' }}>
              {liveEvents.map((e, i) => <div key={i}>{t('lv.fight')} {e.match_id} → 🏆 {e.winner} ({e.score_a}:{e.score_b})</div>)}
            </div>
          )}
        </div>
      )}
      {tab === 'results' && <div className="space-y-3"><Results tid={id!} /><ExportBar tid={id!} /></div>}
      {tab === 'weighin' && <WeighIn regs={regs} tid={id!} />}
    </div>
  );
}

type TabId = (typeof TABS)[number];

const CHECK_TAB: Record<string, TabId> = {
  categories: 'overview', registrations: 'participants', weighin: 'weighin',
  brackets: 'brackets', conflicts: 'schedule',
};
const CHECK_ORDER = ['categories', 'registrations', 'weighin', 'brackets', 'conflicts'];

/** Operational overview: readiness %, blockers with actions, next step.
 *  Public viewers see only the stage + progress; staff see the checklist. */
function Readiness({ tt, validation, canManage, onTab }: {
  tt: TournamentDetailT; validation: ValidationItem[] | undefined; canManage: boolean; onTab: (t: TabId) => void;
}) {
  const { t } = useLang();
  if (!validation) return <div className="card p-5"><Skeleton className="h-20" /></div>;
  const top = validation.filter(v => CHECK_ORDER.includes(v.key));
  const extra = validation.filter(v => !CHECK_ORDER.includes(v.key) && !v.ok);
  const done = top.filter(v => v.ok).length;
  const pct = top.length ? Math.round((done / top.length) * 100) : 0;
  const next = CHECK_ORDER.map(k => top.find(v => v.key === k)).find(v => v && !v.ok);
  const rows = canManage ? [...top, ...extra] : [];
  return (
    <div className="card p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-extrabold text-sm flex-1">{t('ov.ready')} · {pct}%</div>
        <span className="text-xs font-bold" style={{ color: 'var(--muted)' }}>{t('ov.stage')}: {t(`status.${tt.status}`)}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('ov.ready')}
        style={{ background: 'var(--border)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)', transition: 'width .4s ease' }} />
      </div>
      {rows.map(v => {
        const tab = CHECK_TAB[v.key] ?? (v.key.startsWith('cat-') ? 'participants' : 'overview');
        const warn = v.level === 'warning';
        return (
          <div key={v.key} className="check-row">
            {v.ok
              ? <CheckCircle2 size={16} className="flex-none mt-0.5" style={{ color: 'var(--ok)' }} />
              : <AlertTriangle size={16} className="flex-none mt-0.5" style={{ color: warn ? 'var(--warn)' : 'var(--live)' }} />}
            <span className="flex-1">{v.message}
              {v.suggestion && <span className="block text-[13px]" style={{ color: 'var(--muted)' }}>→ {v.suggestion}</span>}
            </span>
            {canManage && !v.ok && tab !== 'overview' && (
              <button className="btn-ghost text-xs !py-1.5 flex-none" onClick={() => onTab(tab)}>{t('ov.open')}</button>
            )}
          </div>
        );
      })}
      {canManage && next && CHECK_TAB[next.key] !== 'overview' && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs font-bold" style={{ color: 'var(--muted)' }}>{t('ov.next')}:</span>
          <button className="btn-primary text-sm" onClick={() => onTab(CHECK_TAB[next.key])}>
            {t(`tab.${CHECK_TAB[next.key]}`)} <ArrowRight size={15} />
          </button>
        </div>
      )}
      {canManage && !next && <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('ov.allOk')}</div>}
    </div>
  );
}

function ImportBox({ tid }: { tid: string }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch(`/api/tournaments/${tid}/registrations/import`, { method: 'POST', body: fd, credentials: 'include', headers: { 'Accept-Language': localStorage.getItem('kwf-lang') || 'ru' } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || `Error ${res.status}`);
      setSummary(body);
      qc.invalidateQueries({ queryKey: ['regs', tid] });
    } catch (e: unknown) { setSummary({ summary: errMsg(e), errors: [] }); }
    setBusy(false);
  };
  return (
    <div className="card p-3 text-sm space-y-2">
      <label className="font-bold block">{t('p.impT')} <span className="font-normal" style={{ color: 'var(--muted)' }}>{t('p.impHint')}</span></label>
      <input type="file" accept=".csv,.xlsx" aria-label={t('p.impT')} disabled={busy}
             onChange={e => upload(e.target.files?.[0])} />
      {summary && (
        <div>
          <div>{summary.summary}</div>
          {!!summary.errors?.length && (
            <ul className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
              {summary.errors.slice(0, 5).map((e, i: number) => <li key={i}>{t('p.impRow')} {e.row}: {e.error}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const WI_LABEL: Record<string, string> = { ok: 'w.ok', over: 'w.over', under: 'w.under', pending: 'w.pending' };

function Participants({ tid }: { tid: string }) {
  const { t } = useLang();
  const { can } = useAuth();
  const canImport = can('tournaments.manage');
  const canCheckin = canImport || can('matches.manage');
  const { data: regsRaw } = useRegs(tid);
  const regs: Registration[] = pageItems(regsRaw);
  const toggle = useCheckin(tid);
  if (!regs.length) return (
    <div className="space-y-2">
      <EmptyState title={t('p.empty')} hint={t('p.emptyHint')} />
      {canImport && <ImportBox tid={tid} />}
    </div>
  );
  const done = regs.filter((r) => r.checked_in).length;
  return (
    <div className="space-y-2">
      {canImport && <ImportBox tid={tid} />}
      <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('p.checkin')}: {done}/{regs.length}</div>
      {regs.map((r) => (
        <div key={r.id} className="card p-3 flex items-center gap-3">
          <div className="flex-1"><div className="font-semibold text-sm">{r.athlete}</div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>{r.weigh_in_kg ? `${r.weigh_in_kg}${t('w.kg')} · ` : ''}{r.weigh_in_status !== 'pending' ? t(WI_LABEL[r.weigh_in_status] ?? 'w.pending') : t('p.notWeighed')}</div></div>
          {canCheckin && (
          <button onClick={() => toggle.mutate(r)} disabled={toggle.isPending} aria-label={`${t('p.checkin')} ${r.athlete}`}
                  className="card px-4 py-2 text-sm font-bold" style={r.checked_in ? { borderColor: 'var(--accent)' } : {}}>
            {r.checked_in ? t('p.present') : t('p.mark')}
          </button>
          )}
        </div>
      ))}
    </div>
  );
}

function BracketView({ brackets, showSchedule }: { brackets: Bracket[] | undefined; showSchedule?: boolean }) {
  const { t } = useLang();
  if (!brackets?.length) return <EmptyState title={t('br.empty')} hint={t('br.emptyHint')} />;
  return <div className="space-y-4">{brackets.map(b => {
    const rounds = Array.from(new Set<number>(b.matches.map((m) => m.round))).sort((x, y) => x - y);
    const total = rounds.length;
    const roundName = (r: number) => {
      const fromEnd = total - r;
      return fromEnd === 0 ? t('br.final') : fromEnd === 1 ? t('br.semi') : fromEnd === 2 ? t('br.quarter') : `${t('br.round')} ${r}`;
    };
    return (
      <div key={b.id} className="card p-4 md:p-5 overflow-x-auto" role="region" aria-label={t('tab.brackets')} tabIndex={0}>
        <div className="font-extrabold text-sm mb-3">{t('res.category')} {b.category_id} · {b.size} · {t('br.single')}</div>
        <div className="flex gap-5 min-w-max items-stretch">{rounds.map(r => (
          <div key={r} className="br-col space-y-2 flex flex-col justify-around">
            <div className="br-round">{roundName(r)}</div>
            {b.matches.filter((m) => m.round === r).map((m) => (
              <div key={m.id} className={`br-match${m.status === 'bye' ? ' bye' : ''}${m.winner ? ' won' : ''}${m.status === 'live' ? ' current' : ''}`}
                style={m.status === 'live' ? { borderColor: 'var(--accent)' } : {}}>
                <Fighter name={m.a ?? t('br.bye')} score={m.score_a} win={m.winner === m.a} />
                <Fighter name={m.b ?? t('br.bye')} score={m.score_b} win={m.winner === m.b} />
                <div className="flex items-center gap-2 mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
                  <span>#{m.id} · {m.status === 'live' ? t('br.current') : m.status === 'bye' ? t('br.bye') : m.status}</span>
                  {m.tatami_id && <span>T{m.tatami_id}</span>}
                  {showSchedule && m.scheduled_at && <span className="inline-flex items-center gap-1"><Clock size={11} />{String(m.scheduled_at).slice(11, 16)}</span>}
                  {m.winner ? <Trophy size={11} style={{ color: 'var(--accent)' }} /> : null}
                </div>
              </div>
            ))}
          </div>))}</div>
      </div>);
  })}</div>;
}
function Fighter({ name, score, win }: { name: string | number; score: number; win: boolean }) {
  return <div className={`br-fighter${win ? ' winner' : ''}`}><span>{win ? '🏆 ' : ''}{name}</span><span>{score}</span></div>;
}

function WeighIn({ regs, tid }: { regs: Registration[] | undefined; tid: string }) {
  const { t } = useLang();
  const { can } = useAuth();
  const canWeigh = can('tournaments.manage') || can('matches.manage');
  const weighIn = useWeighIn(tid);
  const { data: tt } = useTournament(tid);
  const bounds = new Map((tt?.categories ?? []).map(c => [c.id, c]));
  const [q, setQ] = useState('');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [w, setW] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState('');
  const ql = q.toLowerCase();
  const list = (regs ?? []).filter(r =>
    (r.athlete ?? '').toLowerCase().includes(ql) &&
    (!problemsOnly || r.weigh_in_status === 'over' || r.weigh_in_status === 'under'));
  const submit = (id: number) => {
    const v = Number(w[id]);
    if (!w[id] || !Number.isFinite(v) || v < 20 || v > 250) { setMsg(`${t('common.err')}: ${t('w.kg')} 20–250`); return; }
    weighIn.mutate({ id, weigh_in_kg: v }, {
      onSuccess: (r) => setMsg(`✓ ${r.label}`),
      onError: (e: unknown) => setMsg(`${t('common.err')}: ` + errMsg(e)),
    });
  };
  return <div className="space-y-2">
    <div className="flex gap-2">
      <input aria-label={t('nav.search')} className="field flex-1" placeholder={t('w.searchPh')} value={q} onChange={e => setQ(e.target.value)} />
      <button className="btn-ghost text-sm !py-2 flex-none" aria-pressed={problemsOnly}
        style={problemsOnly ? { borderColor: 'var(--accent)' } : {}}
        onClick={() => setProblemsOnly(v => !v)}>{t('w.problems')}</button>
    </div>
    {msg && <div className="text-sm">{msg}</div>}
    {list.map((r) => {
      const c = bounds.get(r.category_id);
      const lim = c ? `${c.weight_min}–${c.weight_max} ${t('w.kg')}` : '';
      const bad = r.weigh_in_status === 'over' || r.weigh_in_status === 'under';
      return <div key={r.id} className="card p-3 flex items-center gap-3" style={bad ? { borderColor: 'var(--live)' } : {}}>
        <div className="flex-1 min-w-0"><div className="font-semibold text-sm">{r.athlete}</div>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            {lim && <span>{t('w.bounds')}: {lim} · </span>}
            {r.weigh_in_kg ? `${r.weigh_in_kg}${t('w.kg')} · ` : ''}
            {r.weigh_in_status !== 'pending' ? t(WI_LABEL[r.weigh_in_status] ?? 'w.pending') : t('p.notWeighed')}
          </div></div>
        {canWeigh && (<>
          <input aria-label={`${t('a.weight')} ${r.athlete}`} className="field w-24" placeholder={t('w.kg')}
            value={w[r.id] ?? ''} onChange={e => setW({ ...w, [r.id]: e.target.value })} inputMode="decimal" />
          <button className="btn-primary text-sm" onClick={() => submit(r.id)} disabled={weighIn.isPending}>{weighIn.isPending ? '…' : t('common.save')}</button>
        </>)}
      </div>;
    })}
    {!list.length && <EmptyState title={t('w.none')} hint={t('w.noneHint')} />}</div>;
}
