import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import { api, errMsg } from '../lib/api';
import { useSpravkiTemplates, useSpravkiData } from '../lib/queries';
import { EmptyState, Skeleton } from '../components/ui/core';
import type { Athlete, SpravkaTemplate } from '../types/api';

// Wave 1: coach spravki — pick athlete + template, auto-filled data,
// manual fields only for what's missing in the DB, preview → PDF → print.
export function SpravkiSection({ athletes }: { athletes: Athlete[] }) {
  const { t, lang } = useLang();
  const { can } = useAuth();
  const [athleteId, setAthleteId] = useState<number | null>(null);
  const [templateKey, setTemplateKey] = useState<string>('school');
  const [manual, setManual] = useState<Record<string, string>>({});
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const { data: templates, isLoading: tLoading } = useSpravkiTemplates(lang, can('athletes.manage'));
  const { data: auto } = useSpravkiData(athleteId);
  const template: SpravkaTemplate | undefined = (templates ?? []).find((x) => x.key === templateKey)
    ?? (templates ?? [])[0];
  const effKey = template?.key ?? 'school';

  if (!can('athletes.manage')) return null;
  if (tLoading) return <Skeleton className="h-32" />;
  if (!athletes.length) return (
    <section className="space-y-3" aria-label={t('doc.spravki')}>
      <h2 className="font-bold">{t('doc.spravki')}</h2>
      <EmptyState title={t('doc.spravki')} hint={t('doc.noAthletes')} />
    </section>
  );

  const manualFields = (template?.fields ?? []).filter((f) => f.source === 'manual');
  const autoFields = (template?.fields ?? []).filter((f) => f.source === 'auto');
  const missing = manualFields.filter((f) => f.required && !(manual[f.name] ?? '').trim());

  const issue = async () => {
    if (busy || athleteId == null) return;
    if (missing.length) { setMsg(`${t('common.err')}: ${t('doc.fillRequired')}`); return; }
    setBusy(true);
    setMsg('');
    setCode(null);
    try {
      const r = await api<{ code: string }>(
        `/api/spravki/issue?template=${effKey}&athlete_id=${athleteId}&lang=${lang}`,
        { method: 'POST', body: JSON.stringify({ fields: manual }) });
      setCode(r.code);
      setMsg(t('doc.issued'));
    } catch (e: unknown) { setMsg(`${t('common.err')}: ` + errMsg(e)); }
    setBusy(false);
  };

  return (
    <section className="space-y-3" aria-label={t('doc.spravki')}>
      <h2 className="font-bold">{t('doc.spravki')}</h2>
      <div className="card p-5 space-y-3">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>{t('doc.spravkiHint')}</p>
        <div className="grid sm:grid-cols-2 gap-2">
          <select aria-label={t('doc.athlete')} className="field" value={athleteId ?? ''}
                  onChange={(e) => { setAthleteId(e.target.value ? Number(e.target.value) : null); setCode(null); }}>
            <option value="">{t('doc.pickAthlete')}</option>
            {athletes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select aria-label={t('doc.template')} className="field" value={effKey}
                  onChange={(e) => { setTemplateKey(e.target.value); setManual({}); setCode(null); }}>
            {(templates ?? []).map((x) => <option key={x.key} value={x.key}>{x.title}</option>)}
          </select>
        </div>
        {athleteId != null && !!autoFields.length && (
          <div className="text-sm space-y-1 card p-3 print-sheet" style={{ background: 'var(--bg)' }}>
            <div className="font-black text-base">{template?.title}</div>            {autoFields.map((f) => (
              <div key={f.name} className="flex gap-2">
                <span className="font-bold flex-none">{f.label}:</span>
                <span>{auto?.[f.name] || '—'}</span>
              </div>
            ))}
          </div>
        )}
        {athleteId != null && manualFields.map((f) => (
          <div key={f.name}>
            <label className="block text-xs font-bold mb-1" htmlFor={`spravka-${f.name}`}>
              {f.label}{f.required ? ' *' : ''}
            </label>
            <input id={`spravka-${f.name}`} className="field w-full" value={manual[f.name] ?? ''}
                   onChange={(e) => setManual({ ...manual, [f.name]: e.target.value })} />
          </div>
        ))}
        {msg && <div className="text-sm">{msg}</div>}
        <div className="flex gap-2 flex-wrap items-center">
          <button className="btn-primary text-sm" onClick={issue} disabled={busy || athleteId == null}>
            {busy ? '…' : t('doc.preview')}
          </button>
          {code && (
            <>
              <a className="btn-ghost text-sm !py-2" href={`/api/spravki/${code}.pdf`}>{t('doc.download')}</a>
              <button className="btn-ghost text-sm !py-2" onClick={() => window.print()}>{t('doc.print')}</button>
              <Link to={`/verify/${code}`} className="text-sm underline">{code}</Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
