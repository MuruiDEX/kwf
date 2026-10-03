import { useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { CalendarDays, MapPin, Users, Layers, Clock, CheckCircle2, AlertTriangle, ArrowRight, Tv, Swords, Trophy } from 'lucide-react';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { api, pageItems, useLiveSSE, errMsg } from '../lib/api';
import { Badge, EmptyState, Skeleton } from '../components/ui/core';
import { ExportBar, Results } from './Documents';
import { STATUS_TONE, FLOW } from '../components/ui/tournament';
import { useTournament, useRegs, useBrackets, useValidation, useGenBrackets, useGenSchedule, useStatusChange, useCheckin, useWeighIn, useMoveReg, useLiveState, useTatamis, useReferees, useAssignReferee, useUpdateTournament, useCreateCategory, useUpdateCategory, useRegStatus, useBulkRegStatus, useMyAthleteProfile, useMyRegistrations, useCorrectMatch } from '../lib/queries';
import type { Bracket, BracketMatch, Category, LiveEvent, MyAthlete, Registration, TournamentDetail as TournamentDetailT, TournamentStatus, ValidationItem } from '../types/api';

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
          {canManage && <TournamentEditCard tt={tt} />}
          {canManage && <CategoriesCard tid={id!} categories={tt.categories ?? []} />}
          {canManage && <JudgesCard tid={id!} />}
          <ApplyCard tid={id!} categories={tt.categories ?? []} />
          {flowMsg && <div className="card p-3 text-sm">{flowMsg}</div>}
          {genB.isError || genS.isError ? <div className="card p-3 text-sm">{t('ov.genErr')}</div> : null}
        </div>
      )}
      {tab === 'participants' && <Participants tid={id!} />}
      {tab === 'brackets' && <BracketView tid={id!} brackets={brackets} />}
      {tab === 'schedule' && <BracketView tid={id!} brackets={brackets} showSchedule />}
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
  const [statusF, setStatusF] = useState('');
  const [q, setQ] = useState('');
  const [clubF, setClubF] = useState('');
  const [catF, setCatF] = useState('');
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [note, setNote] = useState<Record<number, string>>({});
  const [bulkNote, setBulkNote] = useState('');
  const [pMsg, setPMsg] = useState('');
  const { data: regsRaw } = useRegs(tid, undefined, statusF);
  const regs: Registration[] = pageItems(regsRaw);
  const toggle = useCheckin(tid);
  const regStatus = useRegStatus(tid);
  const bulkStatus = useBulkRegStatus(tid);
  const { data: tt } = useTournament(tid);
  // Wave 5: moderation closes with the stage (server 409s in live/finished);
  // hide the affordances and say why instead of a cryptic error.
  const locked = tt?.status === 'live' || tt?.status === 'finished';
  const setStatus = (r: Registration, status: 'approved' | 'rejected' | 'withdrawn') => {
    setPMsg('');
    regStatus.mutate({ id: r.id, status, note: note[r.id] ?? '' }, {
      onSuccess: () => setPMsg('✓'),
      onError: (e: unknown) => setPMsg(`${t('common.err')}: ` + errMsg(e)),
    });
  };
  const bulk = (status: 'approved' | 'rejected') => {
    const ids = regs.filter((r) => checked[r.id]).map((r) => r.id);
    if (!ids.length) return;
    setPMsg('');
    bulkStatus.mutate({ ids, status, note: bulkNote }, {
      onSuccess: (r: { updated: number[]; errors: { id: number; error: string }[] }) => {
        setPMsg(`✓ ${r.updated.length}${r.errors.length ? ` · !${r.errors.length}` : ''}`);
        setChecked({});
      },
      onError: (e: unknown) => setPMsg(`${t('common.err')}: ` + errMsg(e)),
    });
  };
  const ST_LABEL: Record<string, string> = { pending: t('rg.pending'), approved: t('rg.approved'), rejected: t('rg.rejected'), withdrawn: t('rg.withdrawn') };
  const clubs = [...new Map(regs.filter((r) => r.club_id != null).map((r) => [r.club_id, r.club] as const)).entries()];
  const ql = q.trim().toLowerCase();
  const shown = regs.filter((r) =>
    (!ql || r.athlete.toLowerCase().includes(ql)) &&
    (!clubF || String(r.club_id) === clubF) &&
    (!catF || String(r.category_id) === catF));
  if (!regs.length && !statusF && !ql && !clubF && !catF) return (
    <div className="space-y-2">
      <EmptyState title={t('p.empty')} hint={t('p.emptyHint')} />
      {canImport && <ImportBox tid={tid} />}
    </div>
  );
  const done = regs.filter((r) => r.checked_in).length;
  const selCount = regs.filter((r) => checked[r.id]).length;
  return (
    <div className="space-y-2">
      {canImport && <ImportBox tid={tid} />}
      <div className="flex gap-2 items-center text-sm flex-wrap">
        <span style={{ color: 'var(--muted)' }}>{t('p.checkin')}: {done}/{regs.length}</span>
        <input aria-label={t('nav.search')} className="field !py-1.5 !text-[13px] flex-1 min-w-[140px]"
               placeholder={t('nav.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t('rg.filter')} className="field !py-1.5 !text-[13px]" value={statusF} onChange={(e) => setStatusF(e.target.value)}>
          <option value="">{t('rg.all')}</option>
          {(['pending', 'approved', 'rejected', 'withdrawn'] as const).map((s) => (
            <option key={s} value={s}>{t(`rg.${s}`)}</option>
          ))}
        </select>
        {!!clubs.length && (
          <select aria-label={t('res.club')} className="field !py-1.5 !text-[13px]" value={clubF} onChange={(e) => setClubF(e.target.value)}>
            <option value="">{t('res.club')}: —</option>
            {clubs.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
          </select>
        )}
        {!!(tt?.categories?.length) && (
          <select aria-label={t('res.category')} className="field !py-1.5 !text-[13px]" value={catF} onChange={(e) => setCatF(e.target.value)}>
            <option value="">{t('res.category')}: —</option>
            {(tt?.categories ?? []).map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        )}
        <Link to={`/tournaments/${tid}?tab=weighin`} className="card px-3 py-1.5 text-xs font-bold">{t('tab.weighin')} →</Link>
      </div>
      {canImport && selCount > 0 && !locked && (
        <div className="card p-3 flex items-center gap-2 text-sm flex-wrap">
          <span className="font-bold">{selCount} ✓</span>
          <input aria-label={t('rg.note')} className="field !py-1.5 !text-[13px] flex-1 min-w-[120px]" placeholder={t('rg.note')}
                 value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} />
          <button className="btn-primary text-xs !py-1.5" disabled={bulkStatus.isPending}
                  onClick={() => bulk('approved')}>{t('rg.approveAll')}</button>
          <button className="btn-ghost text-xs !py-1.5" disabled={bulkStatus.isPending}
                  onClick={() => bulk('rejected')}>{t('rg.rejectAll')}</button>
        </div>
      )}
      {pMsg && <div className="text-sm">{pMsg}</div>}
      {locked && <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('rg.locked')}</div>}
      {!shown.length && <EmptyState title={t('rg.none')} hint="" />}
      {shown.map((r) => (
        <div key={r.id} className="card p-3 flex items-center gap-3">
          {canImport && <input type="checkbox" aria-label={`${t('rg.approveAll')} ${r.athlete}`} checked={!!checked[r.id]} onChange={() => setChecked((s) => ({ ...s, [r.id]: !s[r.id] }))} />}
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">
              <Link to={`/athletes/${r.athlete_id}`} className="hover:underline">{r.athlete}</Link>
            </div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              {r.club && r.club !== '—' ? `${r.club} · ` : ''}{[r.gender, r.birth_year, r.weight != null ? `${r.weight}${t('w.kg')}` : null].filter(Boolean).join(' · ')}
            </div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>{r.weigh_in_kg ? `${r.weigh_in_kg}${t('w.kg')} · ` : ''}{r.weigh_in_status !== 'pending' ? t(WI_LABEL[r.weigh_in_status] ?? 'w.pending') : t('p.notWeighed')}
              {r.status ? <> · <Badge tone={r.status === 'approved' ? 'gold' : r.status === 'pending' ? 'gray' : 'live'}>{ST_LABEL[r.status] ?? r.status}</Badge></> : null}
              {r.review_note ? <> · {r.review_note}</> : null}
            </div>
          </div>
          {canImport && !locked && r.status && r.status !== 'approved' && (
            <button onClick={() => setStatus(r, 'approved')} disabled={regStatus.isPending}
                    className="card px-3 py-2 text-xs font-bold" style={{ borderColor: 'var(--accent)' }}>✓</button>
          )}
          {canImport && !locked && r.status && r.status !== 'rejected' && (
            <span className="flex items-center gap-1">
              <input aria-label={`${t('rg.note')} ${r.athlete}`} className="field w-24 !py-1.5 !text-[13px]" placeholder={t('rg.note')}
                     value={note[r.id] ?? ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
              <button onClick={() => setStatus(r, 'rejected')} disabled={regStatus.isPending}
                      className="card px-3 py-2 text-xs font-bold">✕</button>
            </span>
          )}
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

function BracketView({ tid, brackets, showSchedule }: { tid: string; brackets: Bracket[] | undefined; showSchedule?: boolean }) {
  const { t } = useLang();
  const { can } = useAuth();
  const canCorrect = can('tournaments.manage');
  // Eligible correction targets + fighter names: approved registrations
  // (names included). Loaded once per brackets tab; client-filtered below.
  const { data: regsRaw } = useRegs(tid);
  const regs: Registration[] = pageItems(regsRaw);
  // Wave 7: resolve fighter/category names from the same regs payload
  // (fallback to raw ids when paginated out) — no extra requests.
  const anames = new Map(regs.map((r) => [r.athlete_id, r.athlete] as const));
  const fname = (aid: number | null): string | number => (aid == null ? t('br.bye') : anames.get(aid) ?? `#${aid}`);
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
                <Fighter name={fname(m.a)} score={m.score_a} win={m.winner === m.a} />
                <Fighter name={fname(m.b)} score={m.score_b} win={m.winner === m.b} />
                <div className="flex items-center gap-2 mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
                  <span>#{m.id} · {m.status === 'live' ? t('br.current') : m.status === 'bye' ? t('br.bye') : m.status}</span>
                  {m.tatami_id && <span>T{m.tatami_id}</span>}
                  {showSchedule && m.scheduled_at && <span className="inline-flex items-center gap-1"><Clock size={11} />{String(m.scheduled_at).slice(11, 16)}</span>}
                  {m.winner ? <Trophy size={11} style={{ color: 'var(--accent)' }} /> : null}
                </div>
                {canCorrect && m.round === 1 && m.status === 'scheduled' && !m.winner && (
                  <CorrectForm tid={tid} match={m}
                    candidates={regs.filter((r) => r.category_id === b.category_id && r.status === 'approved')} />
                )}
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
  const moveReg = useMoveReg(tid);
  const { data: tt } = useTournament(tid);
  const bounds = new Map((tt?.categories ?? []).map(c => [c.id, c]));
  // Wave 5: moves lock with the stage/brackets (server 409s); weigh-in itself
  // stays operational in live.
  const moveLocked = tt?.status === 'live' || tt?.status === 'finished';
  const [q, setQ] = useState('');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [w, setW] = useState<Record<number, string>>({});
  const [mv, setMv] = useState<Record<number, string>>({});
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
  // Wave 1: move over/under athlete to another category (bounds re-checked server-side).
  const move = (id: number) => {
    const cid = Number(mv[id]);
    if (!cid) return;
    moveReg.mutate({ id, category_id: cid }, {
      onSuccess: (r) => setMsg(`✓ ${t('w.moved')}${r.warnings?.length ? ` · ${r.warnings.join('; ')}` : ''}`),
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
      return <div key={r.id} className="space-y-2">
      <div className="card p-3 flex items-center gap-3" style={bad ? { borderColor: 'var(--live)' } : {}}>
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
      </div>
      {canWeigh && !moveLocked && bad && (tt?.categories?.length ?? 0) > 1 && (
        <div className="card p-3 flex items-center gap-2">
          <span className="text-xs font-bold flex-1">{t('w.moveTo')}</span>
          <select aria-label={`${t('w.moveTo')} ${r.athlete}`} className="field" value={mv[r.id] ?? ''}
                  onChange={e => setMv({ ...mv, [r.id]: e.target.value })}>
            <option value="">—</option>
            {(tt?.categories ?? []).filter(c => c.id !== r.category_id).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button className="btn-ghost text-sm !py-2" onClick={() => move(r.id)} disabled={moveReg.isPending || !mv[r.id]}>
            {moveReg.isPending ? '…' : t('w.move')}
          </button>
        </div>
      )}
      </div>;
    })}
      {!list.length && <EmptyState title={t('w.none')} hint={t('w.noneHint')} />}</div>;
}

// ---------- Wave 3: owner-only overview cards ----------

function TournamentEditCard({ tt }: { tt: TournamentDetailT }) {
  const { t } = useLang();
  const upd = useUpdateTournament(String(tt.id));
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: tt.name, city: tt.city, country: tt.country, start_date: tt.start_date, type: tt.type, tatami_count: tt.tatami_count });
  const [msg, setMsg] = useState('');
  const locked = tt.status === 'live' || tt.status === 'finished';
  const save = () => {
    setMsg('');
    const patch: Record<string, unknown> = { name: form.name.trim(), city: form.city, country: form.country };
    if (!locked) {
      patch.start_date = form.start_date;
      patch.type = form.type;
      patch.tatami_count = Number(form.tatami_count);
    }
    upd.mutate(patch, {
      onSuccess: () => { setMsg('✓'); setOpen(false); },
      onError: (e: unknown) => setMsg(`${t('common.err')}: ` + errMsg(e)),
    });
  };
  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="font-bold flex-1">{t('ed.title')}</h3>
        <button className="btn-ghost text-xs !py-1.5" onClick={() => setOpen(v => !v)}>{open ? '—' : `✎ ${t('common.edit')}`}</button>
      </div>
      {locked && <div className="text-xs" style={{ color: 'var(--muted)' }}>{t('ed.locked')}</div>}
      {open && (
        <div className="grid sm:grid-cols-2 gap-2">
          <input aria-label={t('n.fTitle')} className="field" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input aria-label={t('c.city')} className="field" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
          <input aria-label={t('a.country')} className="field" value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} />
          {!locked && <>
            <input aria-label={t('a.date')} type="date" className="field" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
            <input aria-label={t('o.type')} className="field" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} />
            <input aria-label={t('ed.tatamis')} type="number" min={1} max={12} className="field" value={form.tatami_count} onChange={e => setForm({ ...form, tatami_count: Number(e.target.value) })} />
          </>}
          <button className="btn-primary text-sm sm:col-span-2 justify-center" onClick={save} disabled={upd.isPending}>{upd.isPending ? '…' : t('common.save')}</button>
          {msg && <div className="text-sm sm:col-span-2">{msg}</div>}
        </div>
      )}
    </div>
  );
}

function CategoriesCard({ tid, categories }: { tid: string; categories: Category[] }) {
  const { t } = useLang();
  const upd = useUpdateCategory(tid);
  const create = useCreateCategory(tid);
  const [editId, setEditId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const blank = { name: '', gender: 'male', age_min: 18, age_max: 99, weight_min: 0, weight_max: 500, level: 'open', fight_duration_sec: 180 };
  const [form, setForm] = useState(blank);
  const [msg, setMsg] = useState('');
  const open = (c: Category) => {
    setEditId(c.id);
    setForm({ name: c.name, gender: c.gender, age_min: c.age_min, age_max: c.age_max, weight_min: c.weight_min, weight_max: c.weight_max, level: (c as { level?: string }).level ?? 'open', fight_duration_sec: (c as { fight_duration_sec?: number }).fight_duration_sec ?? 180 });
    setMsg('');
  };
  const save = () => {
    if (editId == null) return;
    upd.mutate({ id: editId, patch: form }, {
      onSuccess: () => { setMsg('✓'); setEditId(null); },
      onError: (e: unknown) => setMsg(`${t('common.err')}: ` + errMsg(e)),
    });
  };
  const add = () => {
    if (!form.name.trim()) { setMsg(`${t('common.err')}: ${t('cat.needName')}`); return; }
    create.mutate(form, {
      onSuccess: () => { setMsg('✓'); setAdding(false); setForm(blank); },
      onError: (e: unknown) => setMsg(`${t('common.err')}: ` + errMsg(e)),
    });
  };
  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="font-bold flex-1">{t('cat.title')}</h3>
        <button className="btn-ghost text-xs !py-1" onClick={() => { setAdding(v => !v); setEditId(null); setForm(blank); setMsg(''); }}>
          {adding ? '—' : `+ ${t('cat.add')}`}
        </button>
      </div>
      {adding && (
        <div className="grid grid-cols-2 gap-2">
          <input aria-label={t('n.fTitle')} className="field col-span-2" placeholder={t('n.fTitle')} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <select aria-label={t('cat.gender')} className="field" value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
            <option value="male">male</option><option value="female">female</option>
          </select>
          <input aria-label={t('cat.level')} className="field" value={form.level} onChange={e => setForm({ ...form, level: e.target.value })} />
          <input aria-label="age_min" type="number" className="field" value={form.age_min} onChange={e => setForm({ ...form, age_min: Number(e.target.value) })} />
          <input aria-label="age_max" type="number" className="field" value={form.age_max} onChange={e => setForm({ ...form, age_max: Number(e.target.value) })} />
          <input aria-label="weight_min" type="number" className="field" value={form.weight_min} onChange={e => setForm({ ...form, weight_min: Number(e.target.value) })} />
          <input aria-label="weight_max" type="number" className="field" value={form.weight_max} onChange={e => setForm({ ...form, weight_max: Number(e.target.value) })} />
          <button className="btn-primary text-sm col-span-2 justify-center" onClick={add} disabled={create.isPending}>{create.isPending ? '…' : t('common.save')}</button>
        </div>
      )}
      {msg && <div className="text-sm">{msg}</div>}
      {categories.map((c) => (
        <div key={c.id} className="text-sm">
          <div className="flex items-center gap-2">
            <span className="font-semibold flex-1">{c.name} <span style={{ color: 'var(--muted)' }}>{c.gender} · {c.age_min}–{c.age_max} · {c.weight_min}–{c.weight_max}</span></span>
            <button className="btn-ghost text-xs !py-1" onClick={() => (editId === c.id ? setEditId(null) : open(c))}>✎</button>
          </div>
          {editId === c.id && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <input aria-label={t('n.fTitle')} className="field col-span-2" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              <select aria-label={t('cat.gender')} className="field" value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
                <option value="male">male</option><option value="female">female</option>
              </select>
              <input aria-label={t('cat.level')} className="field" value={form.level} onChange={e => setForm({ ...form, level: e.target.value })} />
              <input aria-label="age_min" type="number" className="field" value={form.age_min} onChange={e => setForm({ ...form, age_min: Number(e.target.value) })} />
              <input aria-label="age_max" type="number" className="field" value={form.age_max} onChange={e => setForm({ ...form, age_max: Number(e.target.value) })} />
              <input aria-label="weight_min" type="number" className="field" value={form.weight_min} onChange={e => setForm({ ...form, weight_min: Number(e.target.value) })} />
              <input aria-label="weight_max" type="number" className="field" value={form.weight_max} onChange={e => setForm({ ...form, weight_max: Number(e.target.value) })} />
              <button className="btn-primary text-sm col-span-2 justify-center" onClick={save} disabled={upd.isPending}>{upd.isPending ? '…' : t('common.save')}</button>
              {msg && <div className="text-sm col-span-2">{msg}</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function JudgesCard({ tid }: { tid: string }) {
  const { t } = useLang();
  const { data: tatamis, isLoading } = useTatamis(tid);
  const { data: refs } = useReferees();
  const assign = useAssignReferee(tid);
  const [msg, setMsg] = useState('');
  if (isLoading) return <Skeleton className="h-24" />;
  const set = (tatami_id: number, v: string) => {
    setMsg('');
    assign.mutate({ tatami_id, referee_id: v ? Number(v) : null }, {
      onError: (e: unknown) => setMsg(`${t('common.err')}: ` + errMsg(e)),
    });
  };
  return (
    <div className="card p-4 space-y-2">
      <h3 className="font-bold">{t('judge.title')}</h3>
      {(tatamis ?? []).map((tm) => (
        <div key={tm.id} className="flex items-center gap-2 text-sm">
          <span className="font-semibold flex-1">{tm.name}</span>
          <select aria-label={`${t('judge.title')} ${tm.name}`} className="field" value={tm.referee_id ?? ''}
                  onChange={(e) => set(tm.id, e.target.value)} disabled={assign.isPending}>
            <option value="">—</option>
            {(refs ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      ))}
      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}

// ---------- Wave 6: controlled correction of one pending R1 pair ----------

function CorrectForm({ tid, match, candidates }: { tid: string; match: BracketMatch; candidates: Registration[] }) {
  const { t } = useLang();
  const correct = useCorrectMatch(tid);
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(String(match.a ?? ''));
  const [b, setB] = useState(String(match.b ?? ''));
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  const send = () => {
    setMsg('');
    if (!reason.trim()) { setMsg(`${t('common.err')}: ${t('corr.needReason')}`); return; }
    correct.mutate({ id: match.id, athlete_a_id: Number(a), athlete_b_id: Number(b), reason: reason.trim() }, {
      onSuccess: () => { setMsg(`✓ ${t('corr.done')}`); setOpen(false); },
      onError: (e: unknown) => setMsg(`${t('common.err')}: ` + errMsg(e)),
    });
  };
  return (
    <div className="mt-1">
      {!open
        ? <button className="btn-ghost text-[11px] !py-1" onClick={() => { setOpen(true); setMsg(''); }}>{t('corr.open')}</button>
        : (
          <div className="card p-2 space-y-1.5" style={{ background: 'var(--bg)' }}>
            <div className="grid grid-cols-2 gap-1.5">
              <select aria-label={t('corr.sideA')} className="field !py-1.5 !text-[13px]" value={a} onChange={(e) => setA(e.target.value)}>
                {candidates.map((r) => <option key={r.athlete_id} value={r.athlete_id}>{r.athlete}</option>)}
              </select>
              <select aria-label={t('corr.sideB')} className="field !py-1.5 !text-[13px]" value={b} onChange={(e) => setB(e.target.value)}>
                {candidates.map((r) => <option key={r.athlete_id} value={r.athlete_id}>{r.athlete}</option>)}
              </select>
            </div>
            <input aria-label={t('corr.reason')} className="field w-full !py-1.5 !text-[13px]" placeholder={t('corr.reason')}
                   value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-1.5">
              <button className="btn-primary text-xs !py-1.5 flex-1 justify-center" onClick={send} disabled={correct.isPending}>
                {correct.isPending ? '…' : t('corr.confirm')}
              </button>
              <button className="btn-ghost text-xs !py-1.5" onClick={() => setOpen(false)}>{t('adm.no')}</button>
            </div>
          </div>
        )}
      {msg && <div className="text-xs">{msg}</div>}
    </div>
  );
}

// ---------- Wave 4: athlete self-registration (public categories block) ----------

function fitOf(me: MyAthlete | null | undefined, c: Category): { ok: boolean; why: string[] } {
  if (!me) return { ok: false, why: [] };
  const why: string[] = [];
  if (c.gender !== me.gender) why.push('gender');
  const age = new Date().getFullYear() - me.birth_year;
  if (age < c.age_min || age > c.age_max) why.push('age');
  if (me.weight < c.weight_min || me.weight > c.weight_max) why.push('weight');
  return { ok: why.length === 0, why };
}

function ApplyCard({ tid, categories }: { tid: string; categories: Category[] }) {
  const { t } = useLang();
  const { user, hasRole } = useAuth();
  const { data: tt } = useTournament(tid);
  // Wave 5: registration closes with the stage (server 409s in live/finished).
  const closed = tt?.status === 'live' || tt?.status === 'finished';
  const isAthlete = hasRole('athlete');
  const { data: me } = useMyAthleteProfile(!!user && isAthlete);
  const { data: mine, refetch: refetchMine } = useMyRegistrations(!!user && isAthlete);
  const withdraw = useRegStatus(tid);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  if (!categories.length) return null;
  const myRegs = (mine ?? []).filter((r) => String(r.tournament_id) === String(tid));

  const apply = async (category_id: number) => {
    if (!me) return;
    setBusyId(category_id);
    setMsg('');
    try {
      await api(`/api/tournaments/${tid}/registrations`, {
        method: 'POST', body: JSON.stringify({ athlete_id: me.id, category_id }),
      });
      setMsg('✓');
      refetchMine();
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
    setBusyId(null);
  };
  const drop = (regId: number, ttid: number) => {
    setMsg('');
    withdraw.mutate({ id: regId, status: 'withdrawn' }, {
      onSuccess: () => { setMsg('✓'); refetchMine(); },
      onError: (e: unknown) => setMsg(`${t('common.err')}: ` + errMsg(e)),
    });
    void ttid;
  };

  return (
    <div className="card p-4 space-y-2">
      <h3 className="font-bold">{t('self.title')}</h3>
      {closed && <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('self.closed')}</div>}
      {!user && <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('self.loginHint')}</div>}
      {user && !isAthlete && <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('self.athletesOnly')}</div>}
      {user && isAthlete && !me && (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('self.claimHint')}</div>
      )}
      {categories.map((c) => {
        const fit = fitOf(me ?? null, c);
        const reg = myRegs.find((r) => r.category_id === c.id);
        return (
          <div key={c.id} className="text-sm flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <span className="font-semibold">{c.name}</span>{' '}
              <span style={{ color: 'var(--muted)' }}>{c.gender} · {c.age_min}–{c.age_max} · {c.weight_min}–{c.weight_max}</span>
              {me && (
                fit.ok
                  ? <span> · <Badge tone="gold">{t('self.fits')}</Badge></span>
                  : <span> · <Badge tone="live">{t('self.noFit')}: {fit.why.map((w) => t(`self.why_${w}`)).join(', ')}</Badge></span>
              )}
              {reg && <span> · <Badge tone={reg.reg_status === 'approved' ? 'gold' : 'gray'}>{t(`rg.${reg.reg_status}`)}</Badge></span>}
            </div>
            {me && !closed && !reg && (
              <button className="btn-primary text-xs !py-1.5 flex-none" disabled={busyId === c.id}
                      onClick={() => apply(c.id)}>{busyId === c.id ? '…' : t('self.apply')}</button>
            )}
            {reg && (reg.reg_status === 'approved' || reg.reg_status === 'pending') && !closed && (
              <button className="btn-ghost text-xs !py-1.5 flex-none" disabled={withdraw.isPending}
                      onClick={() => drop(reg.id, reg.tournament_id)}>{t('self.withdraw')}</button>
            )}
          </div>
        );
      })}
      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}
