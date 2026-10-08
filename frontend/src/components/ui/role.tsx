import React from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { useLang } from '../../i18n';

/** Shared role-UX primitives: single source of truth for stat cards,
 *  page headers, sections, quick actions, hero. Replaces 5 copy-pasted
 *  stat-card blocks (Cabinet/Coach/Athlete/Guardian/Admin).
 *
 *  Visual 3.1 rule: primitives stay neutral — role differentiation comes
 *  from composition (order, density, width, emphasis), never from
 *  role-specific colors. Only var(--accent/live/ok/warn) status tones.
 */

/** Per-role content width + rhythm. narrow=personal, medium=calm,
 *  wide=operational, full=management. */
export function PageWrap({ width = 'narrow', dense, spacious, children }: {
  width?: 'narrow' | 'medium' | 'wide' | 'full';
  dense?: boolean; spacious?: boolean; children: React.ReactNode;
}) {
  const w = width === 'narrow' ? 'max-w-3xl' : width === 'medium' ? 'max-w-4xl'
    : width === 'wide' ? 'max-w-5xl' : 'max-w-none';
  const rhythm = dense ? 'space-y-3' : spacious ? 'space-y-6' : 'space-y-5';
  return <div className={`${rhythm} ${w} fade-up`}>{children}</div>;
}

export function PageHeader({ eyebrowKey, titleKey, title, sub, actions }: {
  eyebrowKey?: string; titleKey?: string; title?: string; sub?: React.ReactNode; actions?: React.ReactNode;
}) {
  const { t } = useLang();
  const eb = eyebrowKey ? t(eyebrowKey) : '';
  const ti = title ?? (titleKey ? t(titleKey) : '');
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        {eb && eb !== ti && <span className="eyebrow">{eb}</span>}
        <h1 className="display text-3xl font-semibold mt-1">{ti}</h1>
        {sub && <div className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{sub}</div>}
      </div>
      {actions && <div className="flex gap-2 flex-none">{actions}</div>}
    </div>
  );
}

export function StatCard({ icon: Icon, value, labelKey, label, sub }: {
  icon: LucideIcon; value: React.ReactNode; labelKey?: string; label?: string; sub?: React.ReactNode;
}) {
  const { t } = useLang();
  return (
    <div className="card p-4 min-w-0">
      <Icon size={18} style={{ color: 'var(--accent)' }} />
      <div className="display text-[26px] font-semibold mt-1.5 truncate">{value}</div>
      <div className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{label ?? (labelKey ? t(labelKey) : '')}</div>
      {sub && <div className="text-xs mt-1 truncate font-semibold">{sub}</div>}
    </div>
  );
}

export function SectionCard({ titleKey, title, action, children, dense }: {
  titleKey?: string; title?: string; action?: React.ReactNode; children: React.ReactNode; dense?: boolean;
}) {
  const { t } = useLang();
  return (
    <section className={`card ${dense ? 'p-4' : 'p-5'} space-y-2 min-w-0`} aria-label={title ?? (titleKey ? t(titleKey) : '')}>
      {(title || titleKey || action) && (
        <div className="flex items-center gap-2">
          <h2 className="font-extrabold text-sm flex-1">{title ?? (titleKey ? t(titleKey!) : '')}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function QuickAction({ to, icon: Icon, labelKey, label, hintKey, hint, primary }: {
  to: string; icon: LucideIcon; labelKey?: string; label?: string; hintKey?: string; hint?: string; primary?: boolean;
}) {
  const { t } = useLang();
  return (
    <Link to={to} className="card card-hover p-4 flex items-center gap-3 min-w-0"
      style={primary ? { borderColor: 'var(--accent)' } : {}}>
      <span className="grid place-items-center w-10 h-10 rounded-xl flex-none"
        style={primary
          ? { background: 'var(--accent)', color: '#05080D' }
          : { background: 'var(--accent-soft)', color: 'var(--accent)' }}>
        <Icon size={19} />
      </span>
      <span className="min-w-0">
        <span className="block font-extrabold text-sm leading-tight">{label ?? (labelKey ? t(labelKey) : '')}</span>
        <span className="block text-xs truncate" style={{ color: 'var(--muted)' }}>{hint ?? (hintKey ? t(hintKey!) : '')}</span>
      </span>
    </Link>
  );
}

export function RoleHero({ eyebrowKey, title, sub, badges, primaryCta, secondaryCta }: {
  eyebrowKey: string; title: React.ReactNode; sub?: React.ReactNode;
  badges?: React.ReactNode; primaryCta?: React.ReactNode; secondaryCta?: React.ReactNode;
}) {
  const { t } = useLang();
  return (
    <div className="hero p-5 md:p-6" aria-label={t(eyebrowKey)}>
      <span className="eyebrow">{t(eyebrowKey)}</span>
      <div className="display text-2xl md:text-[28px] font-semibold mt-1.5 leading-tight">{title}</div>
      {sub && <div className="text-sm mt-1.5 max-w-xl" style={{ color: 'var(--muted)' }}>{sub}</div>}
      {badges && <div className="mt-2 flex gap-1.5 flex-wrap">{badges}</div>}
      {(primaryCta || secondaryCta) && (
        <div className="mt-3.5 flex flex-wrap gap-2">{primaryCta}{secondaryCta}</div>
      )}
    </div>
  );
}

export type AttentionTone = 'warn' | 'live' | 'ok' | 'info';
export type AttentionItem = {
  key: string; tone: AttentionTone; titleKey?: string; title?: string;
  detailKey?: string; detail?: string; to?: string; actionLabelKey?: string;
};

/** Attention hierarchy: icon + label + text, never color alone.
 *  Coach/Organizer/Referee surface "what needs me" here. */
export function AttentionList({ items, emptyKey }: { items: AttentionItem[]; emptyKey?: string }) {
  const { t } = useLang();
  const Icon = { warn: AlertTriangle, live: AlertTriangle, ok: CheckCircle2, info: Clock };
  const color = { warn: 'var(--warn)', live: 'var(--live)', ok: 'var(--ok)', info: 'var(--accent)' };
  if (!items.length) {
    return emptyKey
      ? <div className="text-sm" style={{ color: 'var(--muted)' }}>{t(emptyKey)}</div>
      : null;
  }
  return (
    <ul className="space-y-1">
      {items.map((a) => {
        const I = Icon[a.tone];
        const body = (
          <span className="flex items-start gap-2.5 py-1.5 text-sm min-w-0">
            <I size={16} className="flex-none mt-0.5" style={{ color: color[a.tone] }} aria-hidden />
            <span className="flex-1 min-w-0">
              <span className="block font-bold leading-snug">{a.title ?? (a.titleKey ? t(a.titleKey) : '')}</span>
              {(a.detail || a.detailKey) && (
                <span className="block text-[13px] truncate" style={{ color: 'var(--muted)' }}>
                  {a.detail ?? (a.detailKey ? t(a.detailKey) : '')}
                </span>
              )}
            </span>
            {a.to && <span className="text-xs font-bold underline flex-none">{a.actionLabelKey ? t(a.actionLabelKey) : '→'}</span>}
          </span>
        );
        return (
          <li key={a.key} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
            {a.to ? <Link to={a.to} className="block">{body}</Link> : body}
          </li>
        );
      })}
    </ul>
  );
}

export type StageState = 'done' | 'now' | 'todo';
export type Stage = { id: string; labelKey?: string; label?: string; count?: number; state: StageState; to?: string };

/** Operational pipeline strip: stage status with counts, not a decorative
 *  wizard. Used by Organizer (tournament pipeline). */
export function Pipeline({ stages, ariaKey }: { stages: Stage[]; ariaKey?: string }) {
  const { t } = useLang();
  return (
    <div className="pipeline" role="list" aria-label={ariaKey ? t(ariaKey) : undefined}>
      {stages.map((s, i) => {
        const label = s.label ?? (s.labelKey ? t(s.labelKey) : s.id);
        const inner = (
          <span className={`pipeline-step${s.state === 'done' ? ' done' : ''}${s.state === 'now' ? ' now' : ''}`}>
            <span className="pipeline-dot" aria-hidden>{s.state === 'done' ? '✓' : i + 1}</span>
            <span className="min-w-0">
              <span className="block truncate">{label}</span>
              {s.count != null && <span className="pipeline-count">{s.count}</span>}
            </span>
          </span>
        );
        return (
          <span key={s.id} role="listitem" className="pipeline-item">
            {i > 0 && <span className={`pipeline-line${s.state !== 'todo' ? ' done' : ''}`} aria-hidden />}
            {s.to ? <Link to={s.to} className="min-w-0 flex-1">{inner}</Link> : inner}
          </span>
        );
      })}
    </div>
  );
}

export function RoleTabs({ tabs, active, onChange }: {
  tabs: { id: string; labelKey: string }[]; active: string; onChange: (id: string) => void;
}) {
  const { t } = useLang();
  return (
    <div className="tabs" role="tablist">
      {tabs.map((x) => (
        <button key={x.id} className="tab" role="tab" aria-selected={active === x.id} onClick={() => onChange(x.id)}>
          {t(x.labelKey)}
        </button>
      ))}
    </div>
  );
}
