import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FilePlus2, Inbox, Scale, Swords, Tv } from 'lucide-react';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { api, errMsg, pageItems } from '../lib/api';
import { useAudit, useTournaments } from '../lib/queries';
import type { AuditItem, Tournament } from '../types/api';
import { Badge, DataTable, Skeleton } from '../components/ui/core';
import { PageHeader, PageWrap, RoleHero, RoleTabs, SectionCard, QuickAction, AttentionList, Pipeline } from '../components/ui/role';
import type { AttentionItem, Stage } from '../components/ui/role';

const TABS = [
  { id: 'home', labelKey: 'rx.home' },
  { id: 'tournaments', labelKey: 'rx.myTournaments' },
  { id: 'apps', labelKey: 'rx.apps' },
  { id: 'ops', labelKey: 'ov.ready' },
  { id: 'create', labelKey: 'org.create' },
];

type NextOp = { labelKey: string; tab: string };
function nextOpFor(status: string): NextOp {
  switch (status) {
    case 'registration': return { labelKey: 'rx.reviewApps', tab: 'participants' };
    case 'live': return { labelKey: 'rx.openLive', tab: 'live' };
    case 'finished': return { labelKey: 'rx.results', tab: 'results' };
    default: return { labelKey: 'rx.openTournament', tab: 'overview' };
  }
}

/** Tournament operations center (wide, pipeline-first):
 *  active tournament + stage + next operation → pipeline → tournaments → attention. */
export function OrganizerHome() {
  const { t } = useLang();
  const { user, can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'home';
  const setTab = (id: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; }, { replace: true });

  const { data: tournamentsRaw, isLoading } = useTournaments('', '', { enabled: !!user });
  const all: Tournament[] = pageItems(tournamentsRaw);
  const mine = all.filter((x) => x.created_by === user?.id);
  const byStatus = (s: string) => mine.filter((x) => x.status === s);
  const live = byStatus('live');
  const reg = byStatus('registration');
  const upcoming = mine.filter((x) => x.status === 'upcoming' || x.status === 'registration').slice(0, 6);
  const finished = byStatus('finished');
  const firstActive = live[0] ?? reg[0] ?? upcoming[0] ?? mine[0];
  const { data: auditRaw } = useAudit();
  const audit: AuditItem[] = pageItems(auditRaw).slice(0, 5);

  const canOrganize = can('tournaments.manage');
  if (!canOrganize) return null;

  const stages: Stage[] = [
    { id: 'upcoming', labelKey: 'status.upcoming', count: byStatus('upcoming').length, state: mine.length && !byStatus('upcoming').length ? 'done' : byStatus('upcoming').length ? 'now' : 'todo' },
    { id: 'registration', labelKey: 'status.registration', count: reg.length, state: reg.length ? 'now' : live.length || finished.length ? 'done' : 'todo' },
    { id: 'live', labelKey: 'status.live', count: live.length, state: live.length ? 'now' : finished.length ? 'done' : 'todo' },
    { id: 'finished', labelKey: 'status.finished', count: finished.length, state: finished.length ? 'done' : 'todo' },
  ];
  const op = firstActive ? nextOpFor(firstActive.status) : null;

  const attention: AttentionItem[] = [];
  if (reg.length > 0) {
    attention.push({
      key: 'review', tone: 'warn', titleKey: 'rx.reviewApps',
      detail: reg.map((x) => x.name).slice(0, 2).join(' · '),
      to: `/tournaments/${reg[0].id}?tab=participants`, actionLabelKey: 'nav.open',
    });
  }
  if (live.length > 0) {
    attention.push({
      key: 'live', tone: 'live', titleKey: 'rx.openLive',
      detail: live.map((x) => x.name).slice(0, 2).join(' · '),
      to: `/tournaments/${live[0].id}?tab=live`, actionLabelKey: 'nav.open',
    });
  }

  return (
    <PageWrap width="wide">
      <PageHeader eyebrowKey="org.dash" titleKey="org.dash" sub={`${mine.length} · ${t('org.total')}${live.length ? ` · ${t('status.live')}: ${live.length}` : ''}`} />
      <RoleHero
        eyebrowKey="org.dash"
        title={firstActive ? firstActive.name : t('org.noTournaments')}
        sub={firstActive ? `${t(`status.${firstActive.status}`)} · ${firstActive.start_date}${firstActive.city ? ` · ${firstActive.city}` : ''}` : t('me.noTHint')}
        badges={<><Badge tone="gold">{t('role.organizer')}</Badge>{live.length > 0 && <Badge tone="live">live: {live.length}</Badge>}{reg.length > 0 && <Badge tone="navy">{t('status.registration')}: {reg.length}</Badge>}</>}
        primaryCta={tab === 'create' ? undefined : firstActive && op
          ? <Link to={`/tournaments/${firstActive.id}${op.tab === 'overview' ? '' : `?tab=${op.tab}`}`} className="btn-primary text-sm justify-center">{t(op.labelKey)} →</Link>
          : <button className="btn-primary text-sm" onClick={() => setTab('create')}>{t('org.create')} +</button>}
        secondaryCta={firstActive && firstActive.status === 'registration'
          ? <Link to={`/tournaments/${firstActive.id}?tab=weighin`} className="btn-ghost text-sm !py-2">{t('tab.weighin')} →</Link>
          : undefined}
      />
      <RoleTabs tabs={TABS} active={tab} onChange={setTab} />

      {(tab === 'home' || tab === 'tournaments') && (
        <>
          <SectionCard titleKey="org.pipeline">
            <Pipeline stages={stages} ariaKey="org.pipeline" />
          </SectionCard>
          {!!attention.length && tab === 'home' && (
            <SectionCard titleKey="rx.attention">
              <AttentionList items={attention} />
            </SectionCard>
          )}
          <SectionCard titleKey="org.myTournaments" action={<button className="btn-primary text-xs !py-1.5" onClick={() => setTab('create')}>+ {t('org.create')}</button>}>
            {isLoading ? <Skeleton className="h-24" />
              : !mine.length ? <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('org.noTournaments')}</div>
              : mine.slice(0, 8).map((x) => {
                const nx = nextOpFor(x.status);
                return (
                  <div key={x.id} className="card p-3 mb-2 last:mb-0" style={{ background: 'var(--bg)' }}>
                    <div className="flex items-center gap-2">
                      <Link to={`/tournaments/${x.id}`} className="font-extrabold text-sm flex-1 truncate min-w-0">{x.name}</Link>
                      <Badge>{x.status}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--muted)' }}>
                      <span>{x.start_date}{x.city ? ` · ${x.city}` : ''}</span>
                      <Link to={`/tournaments/${x.id}${nx.tab === 'overview' ? '' : `?tab=${nx.tab}`}`} className="font-bold underline" style={{ color: 'var(--accent)' }}>
                        {t('ov.next')}: {t(nx.labelKey)} →
                      </Link>
                    </div>
                  </div>
                );
              })}
          </SectionCard>
          {!!audit.length && tab === 'home' && (
            <SectionCard titleKey="o.audit">
              {audit.map((a) => (
                <div key={a.id} className="text-sm py-1 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                  <b>{a.action}</b> <span style={{ color: 'var(--muted)' }}>{a.entity} #{a.entity_id ?? '—'} · {a.at}</span>
                </div>
              ))}
            </SectionCard>
          )}
        </>
      )}

      {tab === 'apps' && (
        <SectionCard titleKey="rx.apps">
          {!upcoming.length && !reg.length ? <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('rg.none')}</div>
            : (reg.length ? reg : mine).slice(0, 5).map((x) => (
              <div key={x.id} className="text-sm flex items-center gap-2 py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <Link to={`/tournaments/${x.id}?tab=participants`} className="font-semibold flex-1 truncate">{x.name}</Link>
                <Badge>{x.status}</Badge>
                <Link to={`/tournaments/${x.id}?tab=participants`} className="btn-ghost text-xs !py-1 flex-none">{t('rx.reviewApps')}</Link>
              </div>
            ))}
          <div className="text-xs" style={{ color: 'var(--muted)' }}>{t('rg.locked')}</div>
        </SectionCard>
      )}

      {tab === 'ops' && (
        <>
          <SectionCard titleKey="ov.ready">
            {!mine.length ? <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('org.noTournaments')}</div>
              : mine.slice(0, 6).map((x) => (
                <div key={x.id} className="card p-3 flex flex-wrap items-center gap-2">
                  <Link to={`/tournaments/${x.id}`} className="font-bold text-sm flex-1 min-w-[140px] truncate">{x.name}</Link>
                  <Badge>{x.status}</Badge>
                  <Link to={`/tournaments/${x.id}?tab=weighin`} className="btn-ghost text-xs !py-1"><Scale size={12} /> {t('tab.weighin')}</Link>
                  <Link to={`/tournaments/${x.id}?tab=brackets`} className="btn-ghost text-xs !py-1"><Swords size={12} /> {t('tab.brackets')}</Link>
                  <Link to={`/tournaments/${x.id}?tab=live`} className="btn-ghost text-xs !py-1"><Tv size={12} /> live</Link>
                </div>
              ))}
          </SectionCard>
          <DataTable cols={[t('o.aAction'), t('o.aObj'), t('o.aWhen')]} rows={audit.map((a) => [a.action, `${a.entity} #${a.entity_id ?? '—'}`, a.at])} />
        </>
      )}

      {tab === 'create' && <OrganizerCreateCard />}

      {tab === 'home' && (
        <div className="grid sm:grid-cols-2 gap-3">
          {firstActive && op && <QuickAction to={`/tournaments/${firstActive.id}${op.tab === 'overview' ? '' : `?tab=${op.tab}`}`} icon={Inbox} labelKey={op.labelKey} hintKey="rx.apps" primary />}
          {firstActive && <QuickAction to={`/tournaments/${firstActive.id}?tab=weighin`} icon={Scale} labelKey="rx.weighin" hintKey="tab.weighin" />}
          {firstActive && <QuickAction to={`/tournaments/${firstActive.id}?tab=brackets`} icon={Swords} labelKey="rx.genBrackets" hintKey="tab.brackets" />}
          {firstActive && <QuickAction to={`/tournaments/${firstActive.id}?tab=live`} icon={Tv} labelKey="rx.openLive" hintKey="nav.live" />}
          <QuickAction to="/news/new" icon={FilePlus2} labelKey="me.newN" hintKey="nav.news" />
        </div>
      )}
    </PageWrap>
  );
}

function OrganizerCreateCard() {
  const { t } = useLang();
  const [form, setForm] = useState({ name: '', city: '', country: '', start_date: '2026-11-01' });
  const [msg, setMsg] = useState('');
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (busy) return;
    if (form.name.trim().length < 3) { setMsg(`${t('common.err')}: ${t('o.needName')}`); return; }
    setBusy(true);
    try {
      const tt = await api<{ id: number }>('/api/tournaments', { method: 'POST', body: JSON.stringify({ ...form, organization: 'KWF' }) });
      setCreatedId(tt.id);
      setMsg(`${t('o.created')} #${tt.id}. ${t('o.createdHint')}`);
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
    setBusy(false);
  };
  return (
    <SectionCard titleKey="org.create">
      <input aria-label={t('n.fTitle')} className="field w-full" placeholder={t('n.fTitle')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input aria-label={t('c.city')} className="field" placeholder={t('c.city')} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <input aria-label={t('a.country')} className="field" placeholder={t('a.country')} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
        <input aria-label={t('a.date')} type="date" className="field" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary text-sm" onClick={create} disabled={busy}>{busy ? '…' : t('o.create')}</button>
        {createdId && <Link to={`/tournaments/${createdId}`} className="text-sm font-bold underline">{t('o.open')}</Link>}
      </div>
      {msg && <div className="text-sm">{msg}</div>}
      <div className="text-xs" style={{ color: 'var(--muted)' }}>{t('o.wizardHint')}</div>
    </SectionCard>
  );
}
