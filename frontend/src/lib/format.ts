/** Shared date/number formatting (deduplicates Home/Tournaments copies). */

export function fmtDay(iso: string | null | undefined): number | string {
  const d = new Date((iso || '') + 'T00:00');
  return isNaN(+d) ? '—' : d.getDate();
}

export function fmtMon(iso: string | null | undefined, lang: string): string {
  const d = new Date((iso || '') + 'T00:00');
  if (isNaN(+d)) return '';
  return d.toLocaleDateString(lang === 'kk' ? 'kk-KZ' : 'ru-RU', { month: 'short' }).replace('.', '');
}
