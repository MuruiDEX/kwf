import { useState } from 'react';
import { useLang } from '../../i18n';
import { Skeleton } from '../../components/ui/core';
import { errMsg } from '../../lib/api';
import { useTatamis, useReferees, useAssignReferee } from '../../lib/queries';

/** Tatami → referee assignment (owner only — caller gates with tournaments.manage). */
export function JudgesCard({ tid }: { tid: string }) {
  const { t } = useLang();
  const { data: tatamis, isLoading } = useTatamis(tid);
  const { data: refs } = useReferees();
  const assign = useAssignReferee(tid);
  const [msg, setMsg] = useState('');
  if (isLoading) return <Skeleton className="h-24" />;
  const set = (tatami_id: number, v: string) => {
    setMsg('');
    assign.mutate({ tatami_id, referee_id: v ? Number(v) : null }, {
      onError: (e: unknown) => setMsg(`${t('common.err')}: ` + errMsg(e)),
    });
  };
  return (
    <div className="card p-4 space-y-2">
      <h3 className="font-bold">{t('judge.title')}</h3>
      {(tatamis ?? []).map((tm) => (
        <div key={tm.id} className="flex items-center gap-2 text-sm">
          <span className="font-semibold flex-1">{tm.name}</span>
          <select aria-label={`${t('judge.title')} ${tm.name}`} className="field" value={tm.referee_id ?? ''}
                  onChange={(e) => set(tm.id, e.target.value)} disabled={assign.isPending}>
            <option value="">—</option>
            {(refs ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      ))}
      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}
