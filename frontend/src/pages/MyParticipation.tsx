import { Link } from 'react-router-dom';
import { useLang } from '../i18n';
import { liveFight, myMatches, nextFight, placeFromHistory } from '../lib/athlete';
import {
  useAthlete, useAthleteDocs, useAthleteGroups, useBrackets,
} from '../lib/queries';
import { Badge, Skeleton } from '../components/ui/core';
import type { Category, MyRegistration, TournamentDetail } from '../types/api';

const WI_LABEL: Record<string, string> = { ok: 'w.ok', over: 'w.over', under: 'w.under', pending: 'w.pending' };

/** Minimal viewer identity for the participation card. MyAthlete (self) and
 *  ScopedAthlete (approved ward) both satisfy it — Guardian 2.0 reuses this
 *  component read-only without duplicating it. */
export interface ParticipationViewer {
  id: number;
  name: string;
  gender: string;
  birth_year: number;
  weight: number;
}

/** Athlete P2 "My participation": one composed view of an existing
 *  application. All data comes from shared caches (tournament, regs,
 *  brackets, athlete profile/history, groups, docs) — no new endpoints,
 *  no fabricated states. Read-only; mutations live in ApplyCard. */
export function MyParticipation({ tid, tt, me, reg }: {
  tid: string; tt: TournamentDetail; me: ParticipationViewer; reg: MyRegistration;
}) {
  const { t } = useLang();
  const cat: Category | undefined = tt.categories?.find((c) => c.id === reg.category_id);
  const { data: groups } = useAthleteGroups(me.id, true);
  const showBrackets = reg.reg_status === 'approved';
  const { data: brackets, isLoading: brLoading } = useBrackets(tid, { enabled: showBrackets });
  const { data: profile } = useAthlete(String(me.id));
  const { data: docs } = useAthleteDocs(String(me.id), true);

  const mine = myMatches(brackets, me.id);
  const live = liveFight(mine);
  const next = live == null ? nextFight(mine) : null;
  const place = placeFromHistory(profile?.recent_results, Number(tid));
  const finished = tt.status === 'finished';

  return (
    <section className="card p-5 space-y-3" aria-label={t('ath.participation')}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-extrabold flex-1 min-w-0">
          <span className="text-xs font-bold block" style={{ color: 'var(--muted)' }}>{t('ath.participation')}</span>
          <span className="truncate">{me.name}</span>
        </div>
        <Badge tone={reg.reg_status === 'approved' ? 'gold' : reg.reg_status === 'pending' ? 'gray' : 'live'}>
          {t(`rg.${reg.reg_status}`)}
        </Badge>
      </div>

      {cat && (
        <div className="text-sm space-y-1">
          <div className="font-extrabold">{t('ath.myCategory')}</div>
          <div style={{ color: 'var(--muted)' }}>
            {cat.name} · {cat.gender === 'male' ? t('a.men') : t('a.women')} · {cat.age_min}–{cat.age_max} · {cat.weight_min}–{cat.weight_max} {t('w.kg')}
          </div>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            {t('ath.categoryWhy')}: {me.birth_year} {t('a.born')} · {me.gender === 'male' ? t('a.men') : t('a.women')} · {me.weight} {t('w.kg')}
          </div>
        </div>
      )}

      {(groups ?? []).length > 0 && (
        <div className="text-sm">
          <span className="font-extrabold">{t('gr.title')}: </span>
          {(groups ?? []).map((g) => g.name).join(', ')}
        </div>
      )}

      <div className="text-sm flex gap-4 flex-wrap" style={{ color: 'var(--muted)' }}>
        <span>{t('p.checkin')}: {reg.checked_in ? t('p.present') : '—'}</span>
        <span>{t('tab.weighin')}: {reg.weigh_in_status !== 'pending' ? t(WI_LABEL[reg.weigh_in_status] ?? 'w.pending') : t('p.notWeighed')}</span>
      </div>
      {reg.reg_status === 'rejected' && reg.review_note && (
        <div className="text-sm">{t('rg.note')}: {reg.review_note}</div>
      )}

      {showBrackets && (
        <div className="space-y-2">
          {brLoading ? <Skeleton className="h-16" /> : live ? (
            <Link to={`/tournaments/${tid}?tab=live`} className="btn-primary text-sm justify-center">
              {t('ath.watchLive')}
            </Link>
          ) : next ? (
            <div className="flex gap-2 flex-wrap">
              <Link to={`/tournaments/${tid}?tab=brackets`} className="btn-primary text-sm">
                {t('ath.myFight')}
              </Link>
              {next.scheduled_at && (
                <span className="text-sm self-center" style={{ color: 'var(--muted)' }}>
                  {next.scheduled_at.slice(0, 16).replace('T', ' ')}
                </span>
              )}
            </div>
          ) : mine.length ? (
            <Link to={`/tournaments/${tid}?tab=brackets`} className="btn-ghost text-sm !py-2">
              {t('ath.openBracket')}
            </Link>
          ) : (
            <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('ath.noBracket')}</div>
          )}
        </div>
      )}

      {finished && place != null && (
        <div className="display text-2xl font-semibold">
          {place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : ''} {t('ath.place')}: {place}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <Link to={`/athletes/${me.id}`} className="btn-ghost text-sm !py-2">{t('ath.myProfile')}</Link>
        {!!docs?.length && (
          <Link to={`/athletes/${me.id}`} className="btn-ghost text-sm !py-2">
            {t('a.docs')} · {docs.length}
          </Link>
        )}
      </div>
    </section>
  );
}
