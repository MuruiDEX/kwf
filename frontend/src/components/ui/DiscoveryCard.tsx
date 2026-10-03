/** Wave A2: reusable tournament discovery card on the existing KWF DS.
 *  Compact card/list layout at <=640px via CSS (no horizontal tables).
 */
import { Link } from 'react-router-dom';
import { ArrowUpRight, MapPin, Users } from 'lucide-react';
import { Badge } from './core';
import { STATUS_TONE } from './tournament';
import { fmtDay, fmtMon } from '../../lib/format';
import type { Tournament } from '../../types/api';

export function DiscoveryCard({ t, locale }: { t: Tournament; locale: string }) {
  return (
    <Link
      to={`/tournaments/${t.id}`}
      className="card card-hover discovery-card p-4 sm:p-5"
      aria-label={t.name}
      data-testid="discovery-card"
    >
      <div className="discovery-date text-center rounded-xl px-3 py-2 flex-none self-start" style={{ background: 'var(--accent-soft)', border: '1px solid var(--border)' }}>
        <div className="display text-2xl font-semibold">{fmtDay(t.start_date)}</div>
        <div className="text-[11px] font-bold uppercase" style={{ color: 'var(--accent)' }}>{fmtMon(t.start_date, locale)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <Badge tone={STATUS_TONE[t.status] ?? 'gray'}>{t.status}</Badge>
        <div className="font-extrabold mt-1.5 leading-tight line-clamp-2">{t.name}</div>
        <div className="text-[13px] mt-1 flex flex-wrap gap-x-3" style={{ color: 'var(--muted)' }}>
          <span className="inline-flex items-center gap-1"><MapPin size={13} />{t.city}{t.country ? `, ${t.country}` : ''}</span>
          <span className="inline-flex items-center gap-1"><Users size={13} />{t.participants}</span>
        </div>
      </div>
      <ArrowUpRight size={18} className="flex-none discovery-arrow" style={{ color: 'var(--muted)' }} />
    </Link>
  );
}
