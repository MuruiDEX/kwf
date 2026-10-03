import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useLang } from '../i18n';
import { api } from '../lib/api';
import { useNotes } from '../lib/queries';
import { EmptyState, Skeleton } from '../components/ui/core';
import type { KwfNotification } from '../types/api';

// Wave 2: notification center — all/unread filter, mark-all-read,
// per-item read. In-app only; channels plug in server-side later.
export function Notifications() {
  const { t } = useLang();
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: notes, isLoading, isError, refetch } = useNotes(true);
  const list = (notes?.items ?? []).filter((n) => !unreadOnly || !n.is_read);

  const readOne = async (id: number) => {
    try { await api(`/api/notifications/${id}/read`, { method: 'POST' }); } catch { /* gone */ }
    qc.invalidateQueries({ queryKey: ['notes'] });
  };
  const readAll = async () => {
    if (busy) return;
    setBusy(true);
    try { await api('/api/notifications/read-all', { method: 'POST' }); } catch { /* ignore */ }
    qc.invalidateQueries({ queryKey: ['notes'] });
    setBusy(false);
  };

  if (isLoading) return <Skeleton className="h-60" />;
  if (isError) return (
    <div className="card p-6 text-center space-y-2"><div className="font-bold">{t('common.err')}</div>
      <button className="btn-ghost text-sm !py-2" onClick={() => refetch()}>{t('common.retry')}</button></div>
  );
  return (
    <div className="space-y-4 max-w-3xl fade-up">
      <div><span className="eyebrow">{t('nav.notifications')}</span>
        <h1 className="display text-3xl font-semibold mt-1">{t('nt.title')}</h1></div>
      <div className="flex gap-2 items-center">
        <div className="tabs">
          <button className="tab" aria-selected={!unreadOnly} onClick={() => setUnreadOnly(false)}>{t('nt.all')} ({notes?.total ?? 0})</button>
          <button className="tab" aria-selected={unreadOnly} onClick={() => setUnreadOnly(true)}>{t('nt.unread')} ({notes?.unread ?? 0})</button>
        </div>
        <button className="btn-ghost text-sm !py-2 ml-auto" onClick={readAll} disabled={busy || !notes?.unread}>
          {busy ? '…' : t('nav.read')}
        </button>
      </div>
      {!list.length ? <EmptyState title={t('nav.noNotes')} hint="" /> : (
        <div className="card p-2">
          {list.slice(0, 100).map((n) => (
            <div key={n.id} className="flex items-center gap-2 px-3 py-2.5 border-b last:border-0 text-sm"
                 style={{ borderColor: 'var(--border)', opacity: n.is_read ? .65 : 1 }}>
              <span className="badge flex-none">{n.type}</span>
              <span className="flex-1 min-w-0">{n.link ? <Link to={n.link}>{n.message}</Link> : n.message}</span>
              {!n.is_read && <button className="text-xs font-bold underline flex-none" onClick={() => readOne(n.id)}>{t('nav.read')}</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
