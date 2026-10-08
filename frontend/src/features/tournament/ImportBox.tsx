import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLang } from '../../i18n';
import { errMsg } from '../../lib/api';

/** CSV/XLSX import box (owner only — caller gates with tournaments.manage). */
export function ImportBox({ tid }: { tid: string }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [summary, setSummary] = useState<{ summary: string; errors: { row: number; error: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch(`/api/tournaments/${tid}/registrations/import`, { method: 'POST', body: fd, credentials: 'include', headers: { 'Accept-Language': localStorage.getItem('kwf-lang') || 'ru' } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || `Error ${res.status}`);
      setSummary(body);
      qc.invalidateQueries({ queryKey: ['regs', tid] });
    } catch (e: unknown) { setSummary({ summary: errMsg(e), errors: [] }); }
    setBusy(false);
  };
  return (
    <div className="card p-3 text-sm space-y-2">
      <label className="font-bold block">{t('p.impT')} <span className="font-normal" style={{ color: 'var(--muted)' }}>{t('p.impHint')}</span></label>
      <input type="file" accept=".csv,.xlsx" aria-label={t('p.impT')} disabled={busy}
             onChange={(e) => upload(e.target.files?.[0])} />
      {summary && (
        <div>
          <div>{summary.summary}</div>
          {!!summary.errors?.length && (
            <ul className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
              {summary.errors.slice(0, 5).map((e, i: number) => <li key={i}>{t('p.impRow')} {e.row}: {e.error}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
