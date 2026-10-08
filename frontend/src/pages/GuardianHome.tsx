import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileCheck2, User as UserIcon } from 'lucide-react';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { Badge, EmptyState } from '../components/ui/core';
import { PageHeader, PageWrap, RoleHero, SectionCard, QuickAction, RoleTabs } from '../components/ui/role';
import { GuardianDashboard } from './GuardianDashboard';
import { WardDetail } from './Guardian';
import { LinkRequestButton } from './LinkRequest';
import { AthleteDocList } from './Lists';
import { resolveWardId } from '../lib/guardian';
import { useAthleteDocs, useGuardianLinks, useGuardianRegs, useGuardianWards, useScopedAthlete } from '../lib/queries';

const TABS = [
  { id: 'home', labelKey: 'rx.home' },
  { id: 'children', labelKey: 'rx.children' },
  { id: 'tournaments', labelKey: 'rx.childTournaments' },
  { id: 'docs', labelKey: 'rx.docs' },
];

/** Calm read-only ward-first workspace (spacious, no ops density):
 *  ward selector → child status → events → regs → docs. */
export function GuardianHome() {
  const { t } = useLang();
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'home';
  const setTab = (id: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; }, { replace: true });
  const wardsQ = useGuardianWards(!!user);
  const linksQ = useGuardianLinks(!!user);
  const [sel, setSel] = useState<number | null>(null);
  const wards = wardsQ.data ?? [];
  const outgoing = linksQ.data?.outgoing ?? [];
  const current = resolveWardId(wards, sel);
  const ward = wards.find((w) => w.id === current) ?? null;
  const ready = !!user && current != null;
  const regs = useGuardianRegs(current, ready && (tab === 'home' || tab === 'tournaments'));
  const docs = useAthleteDocs(current != null ? String(current) : undefined, ready && tab === 'docs');
  const scoped = useScopedAthlete(current != null ? String(current) : undefined, ready);

  return (
    <PageWrap width="medium" spacious>
      <PageHeader eyebrowKey="guard.title" titleKey="guard.title" sub={t('rx.readOnly')} />
      {!wardsQ.isLoading && !wards.length ? (
        <RoleHero
          eyebrowKey="guard.title"
          title={t('guard.empty')}
          sub={t('guard.emptyHint')}
          primaryCta={<span className="inline-block"><LinkRequestButton /></span>}
        />
      ) : ward != null ? (
        <div className="card p-5 md:p-6" aria-label={t('guard.switch')}>
          <div className="flex items-center gap-3">
            <span className="grid place-items-center w-12 h-12 rounded-full font-black text-lg flex-none"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }} aria-hidden>
              {(ward.name || '?').slice(0, 1).toUpperCase()}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold" style={{ color: 'var(--muted)' }}>{t('guard.ward')}</div>
              <div className="font-extrabold text-lg leading-tight truncate">{ward.name}</div>
              <div className="text-sm truncate" style={{ color: 'var(--muted)' }}>{ward.club ?? ''}</div>
            </div>
            <Badge tone="navy">{t('guard.ward')}</Badge>
          </div>
          {wards.length > 1 && (
            <label className="mt-4 flex items-center gap-2 text-sm font-semibold">
              <UserIcon size={15} style={{ color: 'var(--accent)' }} />
              <span className="flex-none">{t('guard.switch')}</span>
              <select aria-label={t('guard.switch')} className="field flex-1 min-w-0" value={current ?? ''} onChange={(e) => setSel(Number(e.target.value))}>
                {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
          )}
          <div className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>{t('rx.readOnly')}</div>
        </div>
      ) : null}

      <RoleTabs tabs={TABS} active={tab} onChange={setTab} />

      {(tab === 'home' || tab === 'children') && current != null && (
        <section aria-label={t('guard.title')} className="space-y-6">
          <GuardianDashboard wards={wards} currentId={current} outgoing={outgoing} />
          <WardDetail id={current} onGone={() => setSel(null)} />
        </section>
      )}

      {tab === 'tournaments' && (
        <SectionCard titleKey="guard.regs" action={<span className="text-xs" style={{ color: 'var(--muted)' }}>{t('rx.noWeightExact')}</span>}>
          {regs.isLoading ? <div className="text-sm">{t('common.loading')}</div>
            : !regs.data?.length ? <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('guard.regsEmpty')}</div>
            : regs.data.map((r) => (
              <div key={r.id} className="text-sm flex items-center gap-2 py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <Link to={`/tournaments/${r.tournament_id}`} className="font-semibold flex-1 truncate">{r.tournament} · {r.category}</Link>
                <Badge tone={r.reg_status === 'approved' ? 'gold' : 'gray'}>{t(`rg.${r.reg_status}`)}</Badge>
              </div>
            ))}
        </SectionCard>
      )}

      {tab === 'docs' && (
        <SectionCard titleKey="a.docs">
          <div className="text-xs pb-1" style={{ color: 'var(--muted)' }}>{t('rx.readOnly')}</div>
          {docs.isLoading ? <div className="text-sm">{t('common.loading')}</div>
            : !docs.data?.length ? <EmptyState title={t('guard.docsEmpty')} hint={t('nav.verify')} />
            : <AthleteDocList docs={docs.data} />}
          {scoped.data && (
            <div className="text-xs pt-1" style={{ color: 'var(--muted)' }}>
              {scoped.data.name} · {scoped.data.weight_class} · {scoped.data.club}
            </div>
          )}
        </SectionCard>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <span className="contents"><LinkRequestButton compact /></span>
        <QuickAction to="/verify" icon={FileCheck2} labelKey="nav.verify" hintKey="v.sub" />
      </div>
    </PageWrap>
  );
}
