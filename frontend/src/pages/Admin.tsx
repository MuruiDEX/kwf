import { useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Bell, FileText, Inbox, LayoutDashboard, Newspaper, ScrollText, Trophy, type LucideIcon } from 'lucide-react';
import { useLang } from '../i18n';
import { errMsg, pageItems } from '../lib/api';
import { useAuth, notify } from '../auth';
import { Badge, DataTable, EmptyState, Skeleton } from '../components/ui/core';
import { STATUS_TONE } from '../components/ui/tournament';
import { AdminRequests } from './AuthForms';
import { useAudit, useAdminUsers, useAdminUserDetail, usePermCatalog, useUpdateUser, useNews, useOrgRequests, useTournaments } from '../lib/queries';
import type { AdminUser, AuditItem, NewsItem, OrganizerRequest, Role, Tournament } from '../types/api';

function Err({ retry }: { retry: () => void }) {
  const { t } = useLang();
  return (
    <div className="card p-6 text-center space-y-2">
      <div className="font-bold">{t('common.err')}</div>
      <button className="btn-ghost text-sm !py-2" onClick={retry}>{t('common.retry')}</button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 fade-up">
      <div className="text-sm" style={{ color: 'var(--muted)' }}>
        <Link to="/admin">{useLang().t('adm.title')}</Link> / <b style={{ color: 'var(--text)' }}>{title}</b>
      </div>
      <h2 className="display text-2xl font-semibold">{title}</h2>
      {children}
    </div>
  );
}

// ---------- dashboard (partial rendering: each section independent) ----------
function DashCard({ to, icon: Icon, label, query, value }: {
  to: string; icon: LucideIcon; label: string; value?: number;
  query: { isLoading: boolean; isError: boolean; refetch: () => void };
}) {
  const { t } = useLang();
  return (
    <Link to={to} className="card card-hover p-4">
      <Icon size={18} style={{ color: 'var(--accent)' }} />
      {query.isLoading ? <Skeleton className="h-8 mt-1.5" /> :
        query.isError ? (
          <button className="text-xs font-bold underline mt-2" style={{ color: 'var(--live)' }}
            onClick={e => { e.preventDefault(); query.refetch(); }}>{t('common.retry')}</button>
        ) : (
          <div className="display text-[26px] font-semibold mt-1.5">{value ?? 0}</div>
        )}
      <div className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{label}</div>
    </Link>
  );
}

function Dashboard() {
  const { t } = useLang();
  const req = useOrgRequests();
  const tt = useTournaments();
  const news = useNews();
  const users = useAdminUsers();
  const audit = useAudit();
  const liveCount = pageItems<Tournament>(tt.data).filter((x) => x.status === 'live').length;
  return (
    <div className="space-y-4 fade-up">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <DashCard to="/admin/requests" icon={Inbox} label={t('adm.pending')} query={req} value={pageItems<OrganizerRequest>(req.data).length} />
        <DashCard to="/admin/tournaments" icon={Trophy} label={t('adm.totalT')} query={tt} value={pageItems<Tournament>(tt.data).length} />
        <DashCard to="/admin/tournaments" icon={Bell} label={t('adm.liveT')} query={tt} value={liveCount} />
        <DashCard to="/admin/news" icon={Newspaper} label={t('adm.newsN')} query={news} value={pageItems<NewsItem>(news.data).length} />
        <DashCard to="/admin/users" icon={FileText} label={t('adm.usersN')} query={users} value={pageItems<AdminUser>(users.data).length} />
      </div>
      <div className="card p-5 space-y-2">
        <div className="flex items-center">
          <div className="font-extrabold text-sm flex-1">{t('adm.recent')}</div>
          <Link to="/admin/audit" className="text-xs font-bold" style={{ color: 'var(--muted)' }}>{t('adm.viewAll')}</Link>
        </div>
        {audit.isLoading ? <Skeleton className="h-16" /> :
          audit.isError ? <Err retry={() => audit.refetch()} /> :
          !pageItems(audit.data).length ? <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('adm.empty')}</div> :
          pageItems<AuditItem>(audit.data).slice(0, 5).map((a) => (
            <div key={a.id} className="text-sm py-1 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
              <b>{a.action}</b> <span style={{ color: 'var(--muted)' }}>{a.entity} #{a.entity_id ?? '—'} · #{a.actor ?? '—'} · {a.at}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

// ---------- tournaments ----------
function AdminTournaments() {
  const { t } = useLang();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const { data: raw, isLoading, isError, refetch } = useTournaments();
  if (isLoading) return <Skeleton className="h-60" />;
  if (isError || !raw) return <Err retry={() => refetch()} />;
  const list = pageItems<Tournament>(raw).filter((x) =>
    (!status || x.status === status) &&
    (!q || `${x.name} ${x.city}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <Section title={t('adm.tournaments')}>
      <div className="flex flex-wrap gap-2">
        <input aria-label={t('adm.searchPh')} className="field flex-1 min-w-[180px]" placeholder={t('adm.searchPh')} value={q} onChange={e => setQ(e.target.value)} />
        <select aria-label={t('adm.status')} className="field" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">{t('t.all')}</option>
          {['upcoming', 'registration', 'live', 'finished'].map(s => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </select>
      </div>
      {!list.length ? <EmptyState title={t('adm.empty')} hint={t('t.emptyHint')} /> :
        <DataTable cols={['ID', t('a.name'), t('adm.status'), t('a.date'), t('ov.participants')]}
          rows={list.slice(0, 100).map((x) => [x.id,
            <Link key={x.id} to={`/tournaments/${x.id}`} className="font-semibold">{x.name}</Link>,
            <Badge key={x.id} tone={STATUS_TONE[x.status] ?? 'gray'}>{x.status}</Badge>, x.start_date, x.participants])} />}
    </Section>
  );
}

// ---------- news ----------
function AdminNews() {
  const { t } = useLang();
  const [q, setQ] = useState('');
  const { data: raw, isLoading, isError, refetch } = useNews();
  if (isLoading) return <Skeleton className="h-60" />;
  if (isError || !raw) return <Err retry={() => refetch()} />;
  const list = pageItems<NewsItem>(raw).filter((n) => !q || `${n.title} ${n.slug}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Section title={t('adm.news')}>
      <div className="flex flex-wrap gap-2">
        <input aria-label={t('adm.searchPh')} className="field flex-1 min-w-[180px]" placeholder={t('adm.searchPh')} value={q} onChange={e => setQ(e.target.value)} />
        <Link to="/news/new" className="btn-primary text-sm !py-2.5">+ {t('n.new')}</Link>
      </div>
      {!list.length ? <EmptyState title={t('adm.empty')} hint={t('n.emptyHint')} /> :
        <DataTable cols={['ID', t('n.fTitle'), t('n.fCat')]}
          rows={list.slice(0, 100).map((n) => [n.id,
            <Link key={n.id} to={`/news/${n.slug}`} className="font-semibold">{n.title}</Link>, n.category])} />}
    </Section>
  );
}

// ---------- users directory (read for users.view, edit for admin) ----------
const ROLES = ['public', 'athlete', 'coach', 'referee', 'organizer', 'admin'];
function UserEditor({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useLang();
  const { user: me, hasRole } = useAuth();
  const { data: u, isLoading, isError } = useAdminUserDetail(id);
  const { data: catalog } = usePermCatalog(hasRole('admin'));
  const upd = useUpdateUser();
  const [role, setRole] = useState<string | null>(null);
  const [active, setActive] = useState<boolean | null>(null);
  const [grants, setGrants] = useState<string[] | null>(null);
  const [extraRoles, setExtraRoles] = useState<Role[] | null>(null);
  const [msg, setMsg] = useState('');
  const curRole = role ?? u?.role ?? '';
  const curActive = active ?? u?.is_active ?? true;
  const curGrants = grants ?? u?.grants ?? [];
  // Secondary roles (primary excluded — change it via the role select above).
  const SECONDARIES: Role[] = ['coach', 'organizer', 'referee', 'athlete'];
  const baseRoles = extraRoles ?? (u?.roles ?? []).filter((r) => r !== (u?.role ?? ''));
  const isSelf = me?.id === id;
  const save = async () => {
    setMsg('');
    try {
      const newPrimary = role ?? u?.role ?? '';
      const prevRoles = u?.roles ?? [];
      await upd.mutateAsync({ id, patch: {
        ...(role != null && u && role !== u.role ? { role } : {}),
        ...(active != null && u && active !== u.is_active ? { is_active: active } : {}),
        add_permissions: (grants ?? u?.grants ?? []).filter((g) => !(u?.grants ?? []).includes(g)),
        remove_permissions: (u?.grants ?? []).filter((g) => !(grants ?? u?.grants ?? []).includes(g)),
        // Secondary set: checked boxes minus anything already held, plus the
        // previous primary when it changes (a demoted primary stays available
        // instead of silently vanishing from the set).
        add_roles: [...baseRoles.filter((r) => !prevRoles.includes(r)),
                    ...((u && role != null && role !== u.role && !baseRoles.includes(u.role)) ? [u.role] : [])],
        remove_roles: prevRoles.filter((r) => r !== newPrimary && !baseRoles.includes(r)),
      } });
      notify(t('adm.saved'), 'ok');
      onClose();
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
  };
  if (isLoading) return <Skeleton className="h-40" />;
  if (isError || !u) return <Err retry={onClose} />;
  const groups: Record<string, typeof catalog> = {};
  for (const p of catalog ?? []) (groups[p.group] ??= []).push(p);
  return (
    <div className="card p-5 space-y-4 fade-up" aria-label={u.email}>
      <div className="flex items-center gap-2">
        <div className="font-extrabold flex-1 break-all">{u.full_name || '—'} <span style={{ color: 'var(--muted)' }}>{u.email}</span></div>
        <button className="btn-ghost text-xs !py-1.5" onClick={onClose}>{t('adm.no')}</button>
      </div>
      {isSelf && <div className="form-err" role="note">{t('adm.selfEdit')}</div>}
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm font-bold space-y-1 block">{t('adm.role')}
          <select className="field w-full" value={curRole} disabled={isSelf} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
          </select>
        </label>
        <label className="text-sm font-bold space-y-1 block">{t('adm.state')}
          <select className="field w-full" value={curActive ? 'on' : 'off'} disabled={isSelf} onChange={(e) => setActive(e.target.value === 'on')}>
            <option value="on">{t('adm.active')}</option>
            <option value="off">{t('adm.blocked')}</option>
          </select>
        </label>
      </div>
      <div className="space-y-2">
        <div className="font-bold text-sm">{t('adm.roles')}</div>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>{t('adm.rolesHint')}</p>
        <div className="flex flex-wrap gap-1.5">
          {SECONDARIES.map((r) => {
            const isPrimary = (role ?? u?.role) === r;
            const checked = isPrimary || baseRoles.includes(r);
            return (
              <label key={r} className="flex items-center gap-2 text-sm card px-3 py-1.5" style={{ opacity: isPrimary ? .75 : 1 }}>
                <input type="checkbox" checked={checked} disabled={isPrimary}
                  onChange={(e) => setExtraRoles(baseRoles.filter((x) => x !== r).concat(e.target.checked ? [r] : []))} />
                <span className="font-semibold">{t(`role.${r}`)}{isPrimary ? ` · ${t('adm.primary')}` : ''}</span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="space-y-2">
        <div className="font-bold text-sm">{t('adm.grants')}</div>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>{t('adm.grantsHint')}</p>
        {Object.entries(groups).map(([g, items]) => (
          <fieldset key={g} className="card p-3">
            <legend className="text-xs font-extrabold uppercase tracking-wider px-1" style={{ color: 'var(--muted)' }}>{t(`perm.g.${g}`)}</legend>
            <div className="grid sm:grid-cols-2 gap-1.5">
              {(items ?? []).map((p) => {
                const heldRoles = new Set([u.role, ...(u.roles ?? [])]);
                const byRole = heldRoles.has('admin') || (catalog ?? []).find((c) => c.key === p.key)?.roles.some((r) => heldRoles.has(r as Role));
                const checked = byRole || curGrants.includes(p.key);
                return (
                  <label key={p.key} className="flex items-center gap-2 text-sm py-1" style={{ opacity: !p.grantable || byRole ? .75 : 1 }}>
                    <input type="checkbox" checked={checked} disabled={!p.grantable || !!byRole}
                      onChange={(e) => setGrants(curGrants.filter((x) => x !== p.key).concat(e.target.checked ? [p.key] : []))} />
                    <span className="font-semibold">{t(`perm.${p.key}`)}</span>
                    <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                      {!p.grantable ? ` · ${t('adm.locked')}` : byRole ? ` · ${t('adm.byRole')}` : curGrants.includes(p.key) ? ` · ${t('adm.direct')}` : ''}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      {msg && <div className="form-err" role="alert">{msg}</div>}
      <button className="btn-primary text-sm justify-center w-full sm:w-auto" onClick={save} disabled={upd.isPending || isSelf}>
        {upd.isPending ? '…' : t('common.save')}
      </button>
    </div>
  );
}

export function UsersDirectory() {
  const { t } = useLang();
  const { hasRole } = useAuth();
  const canEdit = hasRole('admin');
  const [q, setQ] = useState('');
  const [roleF, setRoleF] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const { data: raw, isLoading, isError, refetch } = useAdminUsers(q, roleF);
  const data: AdminUser[] = pageItems(raw);
  const body = (
    <>
      <div className="flex flex-wrap gap-2">
        <input aria-label={t('adm.searchPh')} className="field flex-1 min-w-[180px]" placeholder={t('adm.searchPh')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t('adm.role')} className="field" value={roleF} onChange={(e) => setRoleF(e.target.value)}>
          <option value="">{t('adm.all')}</option>
          {ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
        </select>
      </div>
      {!data.length ? <EmptyState title={t('adm.empty')} hint={t('t.emptyHint')} /> :
        <DataTable cols={['ID', t('me.email'), t('me.name'), t('adm.role'), t('adm.state'), ...(canEdit ? [''] : [])]}
          rows={data.slice(0, 100).map((u) => [u.id,
            <span key={u.id} className="break-all">{u.email}</span>, u.full_name || '—',
            <span key={u.id} className="flex items-center gap-1.5 flex-wrap">
              <Badge tone={u.role === 'admin' ? 'navy' : u.role === 'organizer' ? 'gold' : 'gray'}>{t(`role.${u.role}`)}{(u.roles ?? []).filter((r) => r !== u.role).map((r) => ` +${t(`role.${r}`)}`).join('')}</Badge>
              {(u.grants ?? []).length > 0 && <Badge tone="gold">+{u.grants!.length}</Badge>}
            </span>,
            u.is_active ? t('adm.active') : t('adm.blocked'),
            ...(canEdit ? [<button key={u.id} className="btn-ghost text-xs !py-1" onClick={() => setEditId(u.id)} aria-label={u.email}>✎</button>] : [])])} />}
      {canEdit && editId != null && (
        <UserEditor id={editId} onClose={() => { setEditId(null); refetch(); }} />
      )}
    </>
  );
  if (!canEdit) {
    return (
      <div className="space-y-3 fade-up">
        <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('adm.usersHint')}</div>
        <h2 className="display text-2xl font-semibold">{t('adm.users')}</h2>
        {isLoading ? <Skeleton className="h-60" /> : isError || !raw ? <Err retry={() => refetch()} /> : body}
      </div>
    );
  }
  return <Section title={t('adm.users')}>{isLoading ? <Skeleton className="h-60" /> : isError || !raw ? <Err retry={() => refetch()} /> : body}</Section>;
}

// ---------- audit ----------
function AdminAudit() {
  const { t } = useLang();
  const [q, setQ] = useState('');
  const { data: raw, isLoading, isError, refetch } = useAudit();
  if (isLoading) return <Skeleton className="h-60" />;
  if (isError || !raw) return <Err retry={() => refetch()} />;
  const list = pageItems<AuditItem>(raw).filter((a) => !q || `${a.action} ${a.entity} ${a.entity_id ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Section title={t('adm.audit')}>
      <input aria-label={t('adm.auditSearch')} className="field w-full" placeholder={t('adm.auditSearch')} value={q} onChange={e => setQ(e.target.value)} />
      {!list.length ? <EmptyState title={t('adm.empty')} hint={t('t.emptyHint')} /> :
        <DataTable cols={[t('o.aAction'), t('o.aObj'), t('o.aWho'), t('o.aWhen')]}
          rows={list.slice(0, 100).map((a) => [a.action, `${a.entity} #${a.entity_id ?? '—'}`, `#${a.actor ?? '—'}`, a.at])} />}
    </Section>
  );
}

function AdminRequestsSection() {
  const { t } = useLang();
  return <Section title={t('adm.requests')}><AdminRequests /></Section>;
}

// ---------- layout ----------
export function Admin() {
  const { t } = useLang();
  const NAV: [string, string, LucideIcon][] = [
    ['/admin', t('adm.dash'), LayoutDashboard],
    ['/admin/requests', t('adm.requests'), Inbox],
    ['/admin/tournaments', t('adm.tournaments'), Trophy],
    ['/admin/news', t('adm.news'), Newspaper],
    ['/admin/users', t('adm.users'), FileText],
    ['/admin/audit', t('adm.audit'), ScrollText],
  ];
  const link = ({ isActive }: { isActive: boolean }) => ({
    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10,
    fontSize: 13.5, fontWeight: 800,
    color: isActive ? 'var(--accent)' : 'var(--text)',
    background: isActive ? 'var(--accent-soft)' : 'transparent',
  });
  return (
    <div className="flex flex-col md:flex-row gap-5 fade-up">
      <aside className="md:w-56 flex-none" aria-label={t('adm.title')}>
        <div className="card p-3 md:sticky md:top-20">
          <div className="px-2 pb-2"><span className="eyebrow">{t('adm.title')}</span></div>
          <nav className="flex md:flex-col gap-1 overflow-x-auto">
            {NAV.map(([to, label, Icon]) => (
              <NavLink key={to} to={to} end={to === '/admin'} style={link}>
                <Icon size={16} /> <span className="whitespace-nowrap">{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="requests" element={<AdminRequestsSection />} />
          <Route path="tournaments" element={<AdminTournaments />} />
          <Route path="news" element={<AdminNews />} />
          <Route path="users" element={<UsersDirectory />} />
          <Route path="audit" element={<AdminAudit />} />
        </Routes>
      </div>
    </div>
  );
}
