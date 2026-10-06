import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../i18n';
import { pageItems } from '../lib/api';
import { useCoaches } from '../lib/queries';
import { DataTable, QueryState } from '../components/ui/core';

/** Coach 2.0 P3: public coach directory (public profiles only). */
export function CoachDirectory() {
  const { t } = useLang();
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const { data: raw, isLoading, isError, refetch } = useCoaches(q, city, country);
  const data = pageItems(raw);
  const empty = !isLoading && !isError && !data.length;
  return (
    <div className="space-y-4">
      <div>
        <span className="eyebrow">{t('coach2.dirEyebrow')}</span>
        <h1 className="display text-3xl font-semibold mt-1">{t('coach2.dir')}</h1>
      </div>
      <div className="flex gap-2 flex-wrap">
        <input aria-label={t('nav.search')} className="field flex-1 min-w-[140px]" placeholder={t('nav.search')}
               value={q} onChange={(e) => setQ(e.target.value)} />
        <input aria-label={t('coach2.city')} className="field w-32" placeholder={t('coach2.city')}
               value={city} onChange={(e) => setCity(e.target.value)} />
        <input aria-label={t('coach2.country')} className="field w-32" placeholder={t('coach2.country')}
               value={country} onChange={(e) => setCountry(e.target.value)} />
      </div>
      {(isLoading || isError || empty) ? (
        <QueryState isLoading={isLoading} isError={isError} isEmpty={empty}
                    retry={() => refetch()} emptyTitle={t('coach2.dirEmpty')} emptyHint="" />
      ) : (
        <DataTable cols={[t('coach2.name'), t('coach2.spec'), t('coach2.city'), t('coach2.athletes')]}
          rows={data.map((c) => [
            <Link key={c.user_id} to={`/coaches/${c.user_id}`} className="flex items-center gap-2 font-semibold">
              {c.avatar && <img src={c.avatar} alt="" className="w-6 h-6 rounded-full object-cover flex-none" />}
              {c.name}
            </Link>,
            c.specialization || '—',
            [c.city, c.country].filter(Boolean).join(', ') || '—',
            c.club ? `${c.club.name} · ${c.athletes_count}` : `${c.athletes_count}`,
          ])} />
      )}
    </div>
  );
}
