import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLang } from '../i18n';
import { api, errMsg, pageItems } from '../lib/api';
import { qk, useAthletes } from '../lib/queries';
import { EmptyState, Skeleton } from '../components/ui/core';

/** Guardian 2.0 link request: UI for the existing POST /guardian/links.
 *
 * Athletes are found through the existing public search; the backend stays
 * authoritative (404 unknown, 409 duplicate/reopen). A link is never treated
 * as access before approval — only the pending notice is shown.
 */
export function LinkRequestButton({ compact = false }: { compact?: boolean }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className={compact ? 'btn-ghost text-xs !py-1 self-start' : 'btn-primary text-sm justify-center'}
              onClick={() => setOpen(true)}>
        {compact ? `+ ${t('guard.request')}` : t('guard.request')}
      </button>
    );
  }
  return <LinkRequestDialog onClose={() => setOpen(false)} />;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'sent' }
  | { kind: 'exists' }
  | { kind: 'unknown' }
  | { kind: 'error'; detail: string };

function LinkRequestDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const trimmed = q.trim();
  // Reuse the public athlete search; disabled until 2+ chars like SearchPage.
  const search = useAthletes(trimmed, trimmed.length >= 2);
  const rows = trimmed.length >= 2 ? pageItems(search.data).slice(0, 8) : [];

  const send = async () => {
    if (picked == null || busy) return;
    setBusy(true);
    setPhase({ kind: 'idle' });
    try {
      await api('/api/guardian/links', { method: 'POST', body: JSON.stringify({ athlete_id: picked }) });
      setPhase({ kind: 'sent' });
      qc.invalidateQueries({ queryKey: qk.guardianLinks });
      qc.invalidateQueries({ queryKey: qk.guardianWards });
    } catch (e: unknown) {
      const status = typeof e === 'object' && e !== null && 'status' in e
        ? (e as { status: number }).status : 0;
      if (status === 409) setPhase({ kind: 'exists' });
      else if (status === 404) setPhase({ kind: 'unknown' });
      else setPhase({ kind: 'error', detail: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-5 space-y-3" role="dialog" aria-label={t('guard.requestTitle')}>
      <div className="flex items-center gap-2">
        <div className="font-extrabold text-sm flex-1">{t('guard.requestTitle')}</div>
        <button className="btn-ghost text-xs !py-1" onClick={onClose}>✕</button>
      </div>
      <input aria-label={t('guard.searchPh')} className="field w-full" placeholder={t('guard.searchPh')}
             value={q} onChange={(e) => { setQ(e.target.value); setPicked(null); setPhase({ kind: 'idle' }); }} />
      {trimmed.length >= 2 && (
        search.isLoading ? <Skeleton className="h-16" /> : !rows.length ? (
          <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('guard.requestUnknownHint')}</div>
        ) : (
          <div className="space-y-1">
            {rows.map((a) => (
              <button key={a.id}
                      className="card p-3 w-full text-left text-sm flex items-center gap-2"
                      style={picked === a.id ? { borderColor: 'var(--accent)' } : undefined}
                      aria-pressed={picked === a.id}
                      onClick={() => { setPicked(a.id); setPhase({ kind: 'idle' }); }}>
                <span className="font-semibold flex-1 truncate">{a.name}</span>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{a.country}</span>
              </button>
            ))}
          </div>
        )
      )}
      <button className="btn-primary text-sm justify-center" disabled={picked == null || busy} onClick={send}>
        {busy ? '…' : t('guard.sendRequest')}
      </button>
      {phase.kind === 'sent' && <div className="text-sm font-semibold">✓ {t('guard.requestSent')}</div>}
      {phase.kind === 'exists' && <div className="text-sm">{t('guard.requestExists')}</div>}
      {phase.kind === 'unknown' && <div className="text-sm">{t('guard.requestUnknown')}</div>}
      {phase.kind === 'error' && <div className="text-sm">{t('common.err')}: {phase.detail}</div>}
      {(phase.kind === 'sent' || phase.kind === 'exists') && (
        <div className="text-xs" style={{ color: 'var(--muted)' }}>{t('guard.requestPendingHint')}</div>
      )}
    </div>
  );
}
