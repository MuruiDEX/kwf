import { useState } from 'react';
import { useLang } from '../i18n';
import { errMsg } from '../lib/api';
import { toAthleteCreate, validateAthleteForm, type AthleteForm } from '../lib/athletes';
import { useCreateAthlete } from '../lib/queries';
import type { Club } from '../types/api';

const BLANK: AthleteForm = {
  first_name: '', last_name: '', gender: 'male', birth_year: '',
  weight_kg: '', level: 'novice', country: '', club_id: '',
};

/** D2 P1: athlete creation for the coach cabinet.
 *
 * Same gate as the roster list below it. The club select offers only the
 * coach's own clubs (plus unattached); cross-club creation stays denied by
 * backend authority (POST /api/athletes 403), never by this dropdown alone.
 */
export function AthleteCreateSection({ clubs }: { clubs: Club[] }) {
  const { t } = useLang();
  const create = useCreateAthlete();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<AthleteForm>({ ...BLANK, club_id: clubs[0] != null ? String(clubs[0].id) : '' });
  const [msg, setMsg] = useState('');

  const set = (patch: Partial<AthleteForm>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    const errKey = validateAthleteForm(form);
    if (errKey) { setMsg(`${t('common.err')}: ${t(errKey)}`); return; }
    setMsg('');
    try {
      await create.mutateAsync(toAthleteCreate(form));
      setMsg('✓');
      setForm({ ...BLANK, club_id: clubs[0] != null ? String(clubs[0].id) : '' });
      setOpen(false);
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
  };

  return (
    <section aria-label={t('ac.title')} className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <div className="font-extrabold text-sm flex-1">{t('ac.title')}</div>
        <button className="btn-ghost text-xs !py-1" onClick={() => { setOpen((v) => !v); setMsg(''); }}>
          {open ? '—' : `+ ${t('ac.add')}`}
        </button>
      </div>
      {open && (
        <div className="grid sm:grid-cols-2 gap-2">
          <input aria-label={t('ac.first')} className="field" placeholder={t('ac.first')}
                 value={form.first_name} onChange={(e) => set({ first_name: e.target.value })} />
          <input aria-label={t('ac.last')} className="field" placeholder={t('ac.last')}
                 value={form.last_name} onChange={(e) => set({ last_name: e.target.value })} />
          <select aria-label={t('ac.gender')} className="field" value={form.gender}
                  onChange={(e) => set({ gender: e.target.value })}>
            <option value="male">{t('a.men')}</option>
            <option value="female">{t('a.women')}</option>
          </select>
          <select aria-label={t('ac.level')} className="field" value={form.level}
                  onChange={(e) => set({ level: e.target.value })}>
            {['novice', 'advanced', 'elite'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <input aria-label={t('ac.birth')} className="field" placeholder={t('ac.birth')} inputMode="numeric"
                 value={form.birth_year} onChange={(e) => set({ birth_year: e.target.value })} />
          <input aria-label={t('ac.weight')} className="field" placeholder={t('ac.weight')} inputMode="decimal"
                 value={form.weight_kg} onChange={(e) => set({ weight_kg: e.target.value })} />
          <input aria-label={t('a.country')} className="field" placeholder={t('a.country')}
                 value={form.country} onChange={(e) => set({ country: e.target.value })} />
          <select aria-label={t('a.club')} className="field" value={form.club_id}
                  onChange={(e) => set({ club_id: e.target.value })}>
            <option value="">{t('ac.noClub')}</option>
            {clubs.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
          <button className="btn-primary text-sm sm:col-span-2 justify-center" onClick={save} disabled={create.isPending}>
            {create.isPending ? '…' : t('common.save')}
          </button>
        </div>
      )}
      {msg && <div className="text-sm">{msg}</div>}
    </section>
  );
}
