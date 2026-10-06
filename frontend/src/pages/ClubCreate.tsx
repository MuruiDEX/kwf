import { useState } from 'react';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { errMsg } from '../lib/api';
import { useClubLogo, useCreateOwnClub, useTransferClub, useUpdateClub } from '../lib/queries';
import type { ClubDetail } from '../types/api';

/** Coach 2.0 P2: coach self-create (owner forced to self server-side). */
export function ClubCreateSection() {
  const { t } = useLang();
  const create = useCreateOwnClub();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', country: '', city: '', coach_name: '', description: '' });
  const [msg, setMsg] = useState('');

  const save = async () => {
    if (form.name.trim().length < 2) { setMsg(`${t('common.err')}: ${t('club2.needName')}`); return; }
    setMsg('');
    try {
      await create.mutateAsync({ ...form, name: form.name.trim() });
      setMsg('✓');
      setForm({ name: '', country: '', city: '', coach_name: '', description: '' });
      setOpen(false);
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
  };

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <div className="font-extrabold text-sm flex-1">{t('club2.create')}</div>
        <button className="btn-ghost text-xs !py-1" onClick={() => { setOpen((v) => !v); setMsg(''); }}>
          {open ? '—' : `+ ${t('club2.create')}`}
        </button>
      </div>
      {open && (
        <div className="grid sm:grid-cols-2 gap-2">
          <input aria-label={t('club2.name')} className="field sm:col-span-2" placeholder={`${t('club2.name')} *`}
                 value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input aria-label={t('a.country')} className="field" placeholder={t('a.country')}
                 value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
          <input aria-label={t('club2.city')} className="field" placeholder={t('club2.city')}
                 value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <input aria-label={t('c.coach')} className="field sm:col-span-2" placeholder={t('c.coach')}
                 value={form.coach_name} onChange={(e) => setForm({ ...form, coach_name: e.target.value })} />
          <textarea aria-label={t('club2.desc')} className="field w-full sm:col-span-2" rows={2}
                    placeholder={t('club2.desc')} value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <button className="btn-primary text-sm sm:col-span-2 justify-center" onClick={save} disabled={create.isPending}>
            {create.isPending ? '…' : t('common.save')}
          </button>
        </div>
      )}
      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}

/** Owner/admin-only club management on the club detail page. */
export function ClubManageSection({ club }: { club: ClubDetail }) {
  const { t } = useLang();
  const { user, hasRole } = useAuth();
  const upd = useUpdateClub(club.id);
  const logo = useClubLogo(club.id);
  const transfer = useTransferClub(club.id);
  const [form, setForm] = useState({
    name: club.name, country: club.country, city: club.city,
    coach_name: club.coach, description: club.description ?? '',
  });
  const [target, setTarget] = useState('');
  const [msg, setMsg] = useState('');

  if (!user || (user.id !== club.owner?.id && !hasRole('admin'))) return null;

  const save = async () => {
    if (form.name.trim().length < 2) { setMsg(`${t('common.err')}: ${t('club2.needName')}`); return; }
    setMsg('');
    try {
      await upd.mutateAsync({ ...form, name: form.name.trim() });
      setMsg('✓');
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
  };

  const onLogo = async (f: File | undefined) => {
    if (!f) return;
    setMsg('');
    if (f.size > 2 * 1024 * 1024) { setMsg(`${t('common.err')}: ${t('coach2.avatarTooBig')}`); return; }
    if (!/^(image\/jpeg|image\/png|image\/webp)$/.test(f.type)) {
      setMsg(`${t('common.err')}: ${t('coach2.avatarType')}`); return;
    }
    try {
      await logo.mutateAsync(f);
      setMsg('✓');
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
  };

  const doTransfer = async () => {
    const id = Number(target);
    if (!Number.isInteger(id) || id <= 0) { setMsg(`${t('common.err')}: ${t('club2.badTarget')}`); return; }
    setMsg('');
    try {
      await transfer.mutateAsync(id);
      setMsg('✓');
      setTarget('');
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
  };

  return (
    <section className="card p-5 space-y-3" aria-label={t('club2.manage')}>
      <h2 className="font-bold">{t('club2.manage')}</h2>
      <div className="grid sm:grid-cols-2 gap-2">
        <input aria-label={t('club2.name')} className="field sm:col-span-2" value={form.name}
               onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input aria-label={t('a.country')} className="field" value={form.country}
               onChange={(e) => setForm({ ...form, country: e.target.value })} />
        <input aria-label={t('club2.city')} className="field" value={form.city}
               onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <input aria-label={t('c.coach')} className="field sm:col-span-2" value={form.coach_name}
               onChange={(e) => setForm({ ...form, coach_name: e.target.value })} />
        <textarea aria-label={t('club2.desc')} className="field w-full sm:col-span-2" rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <button className="btn-primary text-sm sm:col-span-2 justify-center" onClick={save} disabled={upd.isPending}>
          {upd.isPending ? '…' : t('common.save')}
        </button>
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        <label className="btn-ghost text-sm !py-2 cursor-pointer">
          {t('club2.logo')}
          <input type="file" className="hidden" accept="image/jpeg,image/png,image/webp"
                 onChange={(e) => void onLogo(e.target.files?.[0])} />
        </label>
        <input aria-label={t('club2.transfer')} className="field flex-1 min-w-[140px]" placeholder={t('club2.transfer')}
               inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} />
        <button className="btn-ghost text-sm !py-2" onClick={doTransfer} disabled={transfer.isPending}>
          {t('club2.transferGo')}
        </button>
      </div>
      {msg && <div className="text-sm">{msg}</div>}
    </section>
  );
}
