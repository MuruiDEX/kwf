import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../i18n';
import { api, errMsg, pageItems } from '../lib/api';
import { useAudit } from '../lib/queries';
import type { AuditItem } from '../types/api';
import { useAuth } from '../auth';
import { DataTable, Skeleton } from '../components/ui/core';
import { LoginForm, RegisterForm, OrgRequestForm } from './AuthForms';
import { Cabinet } from './Cabinet';

// Organizer wizard (§38): steps with states
export function Organizer() {
  const { t } = useLang();
  const STEPS = [t('o.sInformation'), t('o.sCategories'), t('o.sAthletes'), t('o.sWeighin'), t('o.sSeeding'), t('o.sBrackets'), t('o.sSchedule'), t('o.sReview'), t('o.sPublish')];
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(() => {
    try {
      const saved = localStorage.getItem('kwf-org-form');
      if (saved) return JSON.parse(saved) as { name: string; city: string; country: string; start_date: string };
    } catch { /* corrupted draft ignored */ }
    return { name: '', city: '', country: '', start_date: '2026-11-01' };
  });
  const [msg, setMsg] = useState('');
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const edit = (patch: Partial<typeof form>) => {
    setForm(f => {
      const next = { ...f, ...patch };
      try { localStorage.setItem('kwf-org-form', JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  };
  const create = async () => {
    if (busy) return;
    if (form.name.trim().length < 3) { setMsg(`${t('common.err')}: ${t('o.needName')}`); return; }
    if (!form.start_date) { setMsg(`${t('common.err')}: ${t('a.date')}`); return; }
    setBusy(true);
    try {
      const tt = await api<{ id: number }>('/api/tournaments', { method: 'POST', body: JSON.stringify({ ...form, organization: 'KWF' }) });
      setCreatedId(tt.id);
      setMsg(`${t('o.created')} #${tt.id}. ${t('o.createdHint')}`);
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
    setBusy(false);
  };
  return (
    <div className="space-y-5 max-w-3xl fade-up">
      <div><span className="eyebrow">{t('o.eyebrow')}</span>
        <h1 className="display text-3xl font-semibold mt-1">{t('o.title')}</h1>
        <Link to="/me" className="text-[13px] font-semibold" style={{ color: 'var(--muted)' }}>← {t('nav.cabinet')}</Link></div>
      <div className="card p-5">
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3" aria-label={t('o.title')}>
          {STEPS.map((s, i) => (
            <button key={s} onClick={() => setStep(i)} className={`step text-left${i < step ? ' done' : ''}${i === step ? ' now' : ''}`}>
              <span className="step-dot">{i < step ? '✓' : i + 1}</span>
              <span><span className="block text-[11px] font-bold" style={{ color: 'var(--muted)' }}>{t('o.step')} {String(i + 1).padStart(2, '0')}</span>
              <span className="block text-sm font-bold">{s}</span></span>
            </button>
          ))}
        </div>
      </div>
      <div className="card p-5 md:p-6 space-y-3">
        <div className="display text-lg font-semibold">{STEPS[step]}</div>
        {step === 0 && (<>
          <input aria-label={t('n.fTitle')} className="field w-full" placeholder={t('n.fTitle')} value={form.name} onChange={e => edit({ name: e.target.value })} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input aria-label={t('c.city')} className="field" placeholder={t('c.city')} value={form.city} onChange={e => edit({ city: e.target.value })} />
            <input aria-label={t('a.country')} className="field" placeholder={t('a.country')} value={form.country} onChange={e => edit({ country: e.target.value })} />
            <input aria-label={t('a.date')} type="date" className="field" value={form.start_date} onChange={e => edit({ start_date: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary text-sm" onClick={create} disabled={busy}>{busy ? '…' : t('o.create')}</button>
            {createdId && <Link to={`/tournaments/${createdId}`} className="text-sm font-bold underline">{t('o.open')}</Link>}
          </div>
          {msg && <div className="text-sm">{msg}</div>}
        </>)}
        {step > 0 && <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('o.wizardHint')}</div>}
        <div className="flex gap-2">
          <button className="btn-ghost text-sm !py-2" onClick={() => setStep(s => Math.max(0, s - 1))}>{t('o.back')}</button>
          <button className="btn-ghost text-sm !py-2" onClick={() => setStep(s => Math.min(STEPS.length - 1, s + 1))}>{t('o.next')}</button>
        </div>
      </div>
      <AuditLog />
    </div>
  );
}

// Audit log (§32): who did what and when — organizer/admin only
export function AuditLog() {
  const { t } = useLang();
  const { data: raw, isLoading, isError, refetch } = useAudit();
  const data: AuditItem[] = pageItems(raw);
  if (isLoading) return <Skeleton className="h-24" />;
  if (isError) return (
    <div className="space-y-2">
      <h2 className="font-bold">{t('o.audit')}</h2>
      <div className="card p-4 text-sm space-y-2">
        <div>{t('common.err')}</div>
        <button className="btn-ghost text-xs !py-1.5" onClick={() => refetch()}>{t('common.retry')}</button>
      </div>
    </div>
  );
  if (!raw) return null;
  return (
    <div className="space-y-2">
      <h2 className="font-bold">{t('o.audit')}</h2>
      <DataTable cols={[t('o.aAction'), t('o.aObj'), t('o.aWho'), t('o.aWhen')]}
        rows={data.map((a) => [a.action, `${a.entity} #${a.entity_id ?? '—'}`, `#${a.actor ?? '—'}`, a.at])} />
    </div>
  );
}

// /me: guest sees login/register/request, authorized user sees Cabinet
export function Auth() {
  const { t } = useLang();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<'login' | 'reg'>('login');
  // After logout the guest should land on the login form, not stay on
  // whichever tab was touched before (e.g. registration during sign-up).
  const loggedIn = !!user;
  useEffect(() => { if (!loggedIn) setMode('login'); }, [loggedIn]);
  if (loading) return <Skeleton className="h-60 max-w-md mx-auto" />;
  if (user) return <Cabinet />;
  return (
    <div className="space-y-4 max-w-md mx-auto fade-up">
      <div><span className="eyebrow">{t('me.eyebrow')}</span>
        <h1 className="display text-3xl font-semibold mt-1">{t('me.login')}</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{t('me.guestHint')}</p></div>
      <div className="card p-5 space-y-4">
        <div className="tabs">
          <button className="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>{t('me.in')}</button>
          <button className="tab" aria-selected={mode === 'reg'} onClick={() => setMode('reg')}>{t('me.reg')}</button>
        </div>
        {mode === 'login' ? <LoginForm /> : <RegisterForm />}
      </div>
      <div className="card p-5 space-y-3">
        <h2 className="font-bold">{t('me.reqT')}</h2>
        <OrgRequestForm />
      </div>
    </div>
  );
}
