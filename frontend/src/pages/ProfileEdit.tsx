import { useState } from 'react';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { errMsg } from '../lib/api';
import { profileCompleteness, toProfileBody, validateProfileForm } from '../lib/coach';
import { useAvatar, useMyProfile, useUpdateProfile } from '../lib/queries';
import { Skeleton } from '../components/ui/core';

/** Unified account avatar: real photo when set, initial fallback otherwise.
 *  Single source — used by both the cabinet profile card and the header. */
export function ProfileAvatar({ name, size = 48 }: { name: string; size?: number }) {
  const { user } = useAuth();
  const { data } = useMyProfile(!!user);
  if (data?.avatar) {
    return <img src={data.avatar} alt="" width={size} height={size}
      className="rounded-full object-cover flex-none" style={{ width: size, height: size }} />;
  }
  return (
    <span className="grid place-items-center rounded-full font-black flex-none"
      style={{ background: 'var(--navy)', color: 'var(--bg)', width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {(name || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}
export function ProfileEditSection() {
  const { t } = useLang();
  const { user } = useAuth();
  const profileQ = useMyProfile(!!user);
  const update = useUpdateProfile();
  const avatar = useAvatar();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({
    full_name: '', bio: '', city: '', country: '',
    specialization: '', experience_years: '', is_public: false,
  });
  const [primed, setPrimed] = useState(false);

  if (!user) return null;
  const p = profileQ.data;
  if (profileQ.isLoading) return <Skeleton className="h-24" />;
  if (profileQ.isError || !p) {
    return (
      <div className="card p-6 text-center space-y-2">
        <div className="font-bold">{t('common.err')}</div>
        <button className="btn-ghost text-sm !py-2" onClick={() => profileQ.refetch()}>{t('common.retry')}</button>
      </div>
    );
  }
  if (!primed) {
    setPrimed(true);
    setForm({
      full_name: p.full_name, bio: p.bio, city: p.city, country: p.country,
      specialization: p.specialization,
      experience_years: p.experience_years != null ? String(p.experience_years) : '',
      is_public: p.is_public,
    });
  }
  const comp = profileCompleteness({ ...p, full_name: user.full_name || p.full_name });

  const save = async () => {
    const errKey = validateProfileForm(form);
    if (errKey) { setMsg(`${t('common.err')}: ${t(errKey)}`); return; }
    setMsg('');
    try {
      await update.mutateAsync(toProfileBody(form) as unknown as Record<string, unknown>);
      setMsg('✓');
      setOpen(false);
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg('');
    if (f.size > 2 * 1024 * 1024) { setMsg(`${t('common.err')}: ${t('coach2.avatarTooBig')}`); return; }
    if (!/^(image\/jpeg|image\/png|image\/webp)$/.test(f.type)) {
      setMsg(`${t('common.err')}: ${t('coach2.avatarType')}`); return;
    }
    try {
      await avatar.mutateAsync(f);
      setMsg('✓');
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
  };

  return (
    <section className="card p-5 space-y-3" aria-label={t('coach2.profile')}>
      <div className="flex items-center gap-3">
        {p.avatar ? (
          <img src={p.avatar} alt="" className="w-12 h-12 rounded-full object-cover flex-none" />
        ) : (
          <span className="grid place-items-center w-12 h-12 rounded-full font-black text-lg flex-none"
            style={{ background: 'var(--navy)', color: 'var(--bg)' }} aria-hidden>
            {(user.full_name || user.email || '?').slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-extrabold leading-tight">{t('coach2.profile')}</div>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            {t('coach2.complete')}: {Math.round((comp.done / comp.total) * 100)}%
          </div>
        </div>
        <button className="btn-ghost text-sm !py-2" onClick={() => { setOpen((v) => !v); setMsg(''); }}>
          {open ? '—' : t('common.edit')}
        </button>
      </div>
      {open && (
        <div className="space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            <input aria-label={t('me.name')} className="field" placeholder={`${t('me.name')} *`}
                   value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            <input aria-label={t('coach2.spec')} className="field" placeholder={t('coach2.spec')}
                   value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} />
            <input aria-label={t('coach2.city')} className="field" placeholder={t('coach2.city')}
                   value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            <input aria-label={t('coach2.country')} className="field" placeholder={t('coach2.country')}
                   value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
            <input aria-label={t('coach2.exp')} className="field" placeholder={t('coach2.exp')} inputMode="numeric"
                   value={form.experience_years} onChange={(e) => setForm({ ...form, experience_years: e.target.value })} />
            <label className="field flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_public}
                     onChange={(e) => setForm({ ...form, is_public: e.target.checked })} />
              {t('coach2.public')}
            </label>
          </div>
          <textarea aria-label={t('coach2.bio')} className="field w-full" rows={3} placeholder={t('coach2.bio')}
                    value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          <div className="flex gap-2 items-center flex-wrap">
            <label className="btn-ghost text-sm !py-2 cursor-pointer">
              {t('coach2.avatar')}
              <input type="file" className="hidden" accept="image/jpeg,image/png,image/webp"
                     onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>
            <button className="btn-primary text-sm" onClick={save} disabled={update.isPending || avatar.isPending}>
              {update.isPending ? '…' : t('common.save')}
            </button>
          </div>
        </div>
      )}
      {msg && <div className="text-sm">{msg}</div>}
    </section>
  );
}
