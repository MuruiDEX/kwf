import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useLang } from '../i18n';
import { api, errMsg, pageItems } from '../lib/api';
import { useAuth, notify } from '../auth';
import { Skeleton } from '../components/ui/core';
import { useOrgRequests } from '../lib/queries';
import { firstIssue, loginSchema, orgRequestSchema, registerSchema } from '../lib/validators';
import type { OrganizerRequest } from '../types/api';

function useFrom(defaultTo = '/me'): string {
  const loc = useLocation() as { state?: { from?: string } };
  const from = loc.state?.from;
  return typeof from === 'string' && from.startsWith('/') ? from : defaultTo;
}

export function LoginForm() {
  const { t } = useLang();
  const { login } = useAuth();
  const nav = useNavigate();
  const from = useFrom();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const bad = firstIssue(loginSchema, { email, password });
    if (bad) { setMsg(`${t('common.err')}: ${bad}`); return; }
    setBusy(true);
    setMsg('');
    try {
      await login(email, password);
      notify(t('me.welcome'), 'ok');
      nav(from, { replace: true });
    } catch (e: unknown) {
      const m = `${t('common.err')}: ` + errMsg(e);
      setMsg(m);
      notify(m, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="space-y-3" onSubmit={submit}>
      <input aria-label={t('me.email')} className="field w-full" placeholder={t('me.email')} value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
      <input aria-label={t('me.pass')} type="password" className="field w-full" placeholder={t('me.pass')} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
      <button type="submit" className="btn-primary w-full text-sm justify-center" disabled={busy}>{busy ? '…' : t('me.in')}</button>
      {msg && <div className="form-err" role="alert">{msg}</div>}
    </form>
  );
}

export function RegisterForm() {
  const { t } = useLang();
  const { register } = useAuth();
  const nav = useNavigate();
  const from = useFrom();
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'athlete' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const bad = firstIssue(registerSchema, form);
    if (bad) { setMsg(`${t('common.err')}: ${bad}`); return; }
    setBusy(true);
    setMsg('');
    try {
      // One request: backend creates the user AND sets the auth cookie.
      await register(form);
      notify(t('me.okReg'), 'ok');
      nav(from, { replace: true });
    } catch (e: unknown) {
      const m = `${t('common.err')}: ` + errMsg(e);
      setMsg(m);
      notify(m, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="space-y-3" onSubmit={submit}>
      <input aria-label={t('me.name')} className="field w-full" placeholder={t('me.name')} value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} autoComplete="name" />
      <input aria-label={t('me.email')} className="field w-full" placeholder={t('me.email')} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} autoComplete="email" />
      <input aria-label={t('me.pass')} type="password" className="field w-full" placeholder={t('me.pass')} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
      <select aria-label={t('me.role')} className="field w-full" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
        {['athlete', 'coach', 'referee', 'public'].map(r => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
      </select>
      <button type="submit" className="btn-primary w-full text-sm justify-center" disabled={busy}>{busy ? '…' : t('me.doReg')}</button>
      {msg && <div className="form-err" role="alert">{msg}</div>}
    </form>
  );
}

export function OrgRequestForm() {
  const { t } = useLang();
  const [form, setForm] = useState({ org_name: '', message: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const bad = firstIssue(orgRequestSchema, form);
    if (bad) { setMsg(`${t('common.err')}: ${bad}`); return; }
    setBusy(true);
    try {
      await api('/api/auth/request-organizer', { method: 'POST', body: JSON.stringify(form) });
      setMsg(t('me.sent'));
      notify(t('me.sent'), 'ok');
    } catch (e: unknown) {
      const m = `${t('common.err')}: ` + errMsg(e);
      setMsg(m);
      notify(m, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="space-y-3" onSubmit={submit}>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>{t('me.reqHint')}</p>
      <input aria-label={t('me.orgName')} className="field w-full" placeholder={t('me.orgName')} value={form.org_name} onChange={e => setForm({ ...form, org_name: e.target.value })} />
      <textarea aria-label={t('me.orgMsg')} className="field w-full" rows={3} placeholder={t('me.orgMsg')} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} />
      <button type="submit" className="btn-ghost w-full text-sm justify-center" disabled={busy}>{busy ? '…' : t('me.send')}</button>
      {msg && <div className="form-err" role="alert">{msg}</div>}
    </form>
  );
}

export function AdminRequests() {
  const { t } = useLang();
  const qc = useQueryClient();
  const { data: raw, isLoading, isError, refetch } = useOrgRequests();
  const data: OrganizerRequest[] = pageItems(raw);
  const [pending, setPending] = useState<{ id: number; approve: boolean; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (isLoading) return <Skeleton className="h-24" />;
  if (isError) return (
    <div className="card p-4 text-sm space-y-2">
      <div>{t('common.err')}</div>
      <button className="btn-ghost text-xs !py-1.5" onClick={() => refetch()}>{t('common.retry')}</button>
    </div>
  );
  if (!raw) return null;
  const decide = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await api(`/api/admin/organizer-requests/${pending.id}/decision?approve=${pending.approve}`, { method: 'POST' });
      notify(pending.approve ? t('adm.approved') : t('adm.rejected'), 'ok');
      qc.invalidateQueries({ queryKey: ['orgreq'] });
      void r;
    } catch (e: unknown) { notify(`${t('common.err')}: ` + errMsg(e), 'err'); }
    setBusy(false);
    setPending(null);
  };
  return (
    <div className="space-y-2">
      <h2 className="font-bold">{t('me.adminT')}</h2>
      {!data.length ? <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('me.noReq')}</div> :
        data.map((r) => (
          <div key={r.id} className="card p-3 flex flex-wrap items-center gap-3 text-sm">
            <div className="flex-1 min-w-0"><b>{r.org_name}</b> — {r.user} ({r.email}){r.message && <span className="block" style={{ color: 'var(--muted)' }}>{r.message}</span>}</div>
            <button className="btn-primary text-xs !py-1.5" onClick={() => setPending({ id: r.id, approve: true, name: r.org_name })}>{t('me.approve')}</button>
            <button className="btn-ghost text-xs !py-1.5" onClick={() => setPending({ id: r.id, approve: false, name: r.org_name })}>{t('me.reject')}</button>
          </div>
        ))}
      {pending && (
        <div role="dialog" aria-label={t('adm.confirmT')} className="fixed inset-0 z-50 p-4 grid place-items-center"
          style={{ background: 'rgba(2,6,12,.55)' }} onClick={() => !busy && setPending(null)}>
          <div className="card p-5 max-w-sm w-full space-y-3 fade-up" style={{ background: 'var(--bg)' }} onClick={e => e.stopPropagation()}>
            <div className="font-bold">{t('adm.confirmT')}</div>
            <div className="text-sm" style={{ color: 'var(--muted)' }}>
              <b style={{ color: 'var(--text)' }}>{pending.name}</b> — {pending.approve ? t('adm.approveQ') : t('adm.rejectQ')}
            </div>
            <div className="flex gap-2">
              <button className="btn-primary text-sm flex-1 justify-center" onClick={decide} disabled={busy}>{busy ? '…' : t('adm.yes')}</button>
              <button className="btn-ghost text-sm flex-1 justify-center" onClick={() => setPending(null)} disabled={busy}>{t('adm.no')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
