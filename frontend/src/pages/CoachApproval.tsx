import { Link } from 'react-router-dom';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { errMsg } from '../lib/api';
import { useAthlete, useGuardianLinkAction, useGuardianLinks } from '../lib/queries';
import { Skeleton } from '../components/ui/core';
import { useState } from 'react';

/** Guardian 2.0 coach-side approval queue.
 *
 * Lists only links the backend deems actionable for this user
 * (GET /guardian/links.incoming); approve/reject hit the existing
 * endpoints — the backend stays source of truth (foreign links 404).
 * Mounted in the coach cabinet; renders nothing when the queue is empty.
 */
export function CoachApprovalSection() {
  const { t } = useLang();
  const { user } = useAuth();
  const linksQ = useGuardianLinks(!!user);
  const incoming = linksQ.data?.incoming ?? [];

  if (!user) return null;
  if (linksQ.isLoading) return <Skeleton className="h-24" />;
  if (linksQ.isError || !incoming.length) return null;
  return (
    <section className="space-y-3" aria-label={t('guard.incoming')}>
      <h2 className="font-bold">{t('guard.incoming')}</h2>
      <div className="card p-5 space-y-2">
        {incoming.map((l) => (
          <ApprovalRow key={l.id} linkId={l.id} athleteId={l.athlete_id} />
        ))}
      </div>
    </section>
  );
}

function ApprovalRow({ linkId, athleteId }: { linkId: number; athleteId: number }) {
  const { t } = useLang();
  const { data: athlete } = useAthlete(String(athleteId));
  const act = useGuardianLinkAction();
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);

  const decide = async (action: 'approve' | 'reject') => {
    setMsg('');
    try {
      await act.mutateAsync({ lid: linkId, action });
      setDone(true);
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
  };

  if (done) return null;
  return (
    <div className="text-sm flex items-center gap-2">
      <Link to={`/athletes/${athleteId}`} className="font-semibold flex-1 truncate">
        {athlete?.name ?? `#${athleteId}`}
      </Link>
      {msg ? (
        <span>{msg}</span>
      ) : (
        <>
          <button className="btn-primary text-xs !py-1" disabled={act.isPending}
                  onClick={() => void decide('approve')}>{t('guard.approve')}</button>
          <button className="btn-ghost text-xs !py-1" disabled={act.isPending}
                  onClick={() => void decide('reject')}>{t('guard.reject')}</button>
        </>
      )}
    </div>
  );
}
