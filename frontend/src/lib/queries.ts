/** Domain query layer: stable keys + typed hooks. Keys match the pre-P2
 *  strings exactly so existing caches survive the migration.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { api } from './api';
import type {
  AdminUser, AdminUserDetail, Athlete, AthleteProfile, AuditItem, Bracket, Category, Club, ClubDetail,
  DocVerify, LiveState, NewsDetail, NewsItem, NotesResponse,
  OrganizerRequest, Paged, PermissionMeta, RankingEntry, Registration, ReportResponse, ResultsResponse,
  Tournament, TournamentDetail, TournamentStatus, ValidationItem,
} from '../types/api';

export const qk = {
  me: ['me'],
  tournaments: (q = '', status = '') =>
    q || status ? (['tournaments', q, status] as const) : (['tournaments'] as const),
  tournamentsLive: ['tournaments-live'] as const,
  tournament: (id: string | number) => ['t', String(id)] as const,
  regs: (id: string | number) => ['regs', String(id)] as const,
  brackets: (id: string | number) => ['br', String(id)] as const,
  validation: (id: string | number, lang: string) => ['val', String(id), lang] as const,
  live: (id: string | number) => ['live', String(id)] as const,
  athletes: (q: string) => ['athletes', q] as const,
  athlete: (id: string | number) => ['athlete', String(id)] as const,
  rankings: (qs = '') => (qs ? (['rankings', qs] as const) : (['rankings'] as const)),
  clubs: ['clubs'] as const,
  club: (id: string | number) => ['club', String(id)] as const,
  news: ['news'] as const,
  newsDetail: (slug: string) => ['news', slug] as const,
  notes: ['notes'] as const,
  audit: ['audit'] as const,
  orgreq: ['orgreq'] as const,
  adminUsers: (q = '', role = '') =>
    q || role ? (['admin-users', q, role] as const) : (['admin-users'] as const),
  verify: (submitted: string, nonce: number) => ['verify', submitted, nonce] as const,
  results: (tid: string | number) => ['results', String(tid)] as const,
  report: (tid: string | number, lang: string) => ['report', String(tid), lang] as const,
};

type Opt<T> = Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>;

// ---------- tournaments ----------
export function useTournaments(q = '', status = '', opt?: Opt<Paged<Tournament>>) {
  return useQuery<Paged<Tournament>>({ queryKey: qk.tournaments(q, status), queryFn: () => api(`/api/tournaments?q=${encodeURIComponent(q)}&status=${status}`), ...opt });
}
export function useTournamentsLive() {
  return useQuery<Paged<Tournament>>({ queryKey: qk.tournamentsLive, queryFn: () => api('/api/tournaments?status=live') });
}
export function useTournament(id: string | undefined, opt?: Opt<TournamentDetail>) {
  return useQuery<TournamentDetail>({ queryKey: qk.tournament(id ?? ''), queryFn: () => api(`/api/tournaments/${id}`), retry: false, enabled: !!id, ...opt });
}
export function useRegs(id: string | undefined, opt?: Opt<Paged<Registration>>) {
  return useQuery<Paged<Registration>>({ queryKey: qk.regs(id ?? ''), queryFn: () => api(`/api/tournaments/${id}/registrations`), enabled: !!id, ...opt });
}
export function useBrackets(id: string | undefined, opt?: Opt<Bracket[]>) {
  return useQuery<Bracket[]>({ queryKey: qk.brackets(id ?? ''), queryFn: () => api(`/api/tournaments/${id}/brackets`), enabled: !!id, ...opt });
}
export function useValidation(id: string | undefined, lang: string, opt?: Opt<ValidationItem[]>) {
  return useQuery<ValidationItem[]>({ queryKey: qk.validation(id ?? '', lang), queryFn: () => api(`/api/tournaments/${id}/validate?lang=${lang}`), enabled: !!id, ...opt });
}
export function useLiveState(id: string | undefined) {
  return useQuery<LiveState>({ queryKey: qk.live(id ?? ''), queryFn: () => api(`/api/tournaments/${id}/live`), staleTime: 10_000, refetchOnWindowFocus: false, enabled: !!id });
}
export function useResults(tid: string) {
  return useQuery<ResultsResponse>({ queryKey: qk.results(tid), queryFn: () => api(`/api/tournaments/${tid}/results`) });
}
export function useReport(tid: string, lang: string) {
  return useQuery<ReportResponse>({ queryKey: qk.report(tid, lang), queryFn: () => api(`/api/tournaments/${tid}/report?lang=${lang}`) });
}

// ---------- people ----------
export function useAthletes(q: string) {
  return useQuery<Paged<Athlete>>({ queryKey: qk.athletes(q), queryFn: () => api(`/api/athletes?q=${encodeURIComponent(q)}`) });
}
export function useMyAthletes(enabled = true) {
  return useQuery<Paged<Athlete>>({ queryKey: ['my-athletes'], queryFn: () => api('/api/athletes?mine=true'), enabled });
}
export function useMyClubs(enabled = true) {
  return useQuery<Paged<Club>>({ queryKey: ['my-clubs'], queryFn: () => api('/api/clubs?mine=true'), enabled });
}
export function useAthlete(id: string | undefined) {
  return useQuery<AthleteProfile>({ queryKey: qk.athlete(id ?? ''), queryFn: () => api(`/api/athletes/${id}`), retry: false, enabled: !!id });
}
export function useRankings(qs = '') {
  return useQuery<Paged<RankingEntry>>({ queryKey: qk.rankings(qs), queryFn: () => api(`/api/rankings?${qs}`) });
}
export function useClubs() {
  return useQuery<Paged<Club>>({ queryKey: qk.clubs, queryFn: () => api('/api/clubs') });
}
export function useClub(id: string | undefined) {
  return useQuery<ClubDetail>({ queryKey: qk.club(id ?? ''), queryFn: () => api(`/api/clubs/${id}`), retry: false, enabled: !!id });
}

// ---------- content / admin ----------
export function useNews() {
  return useQuery<Paged<NewsItem>>({ queryKey: qk.news, queryFn: () => api('/api/news') });
}
export function useNewsDetail(slug: string | undefined) {
  return useQuery<NewsDetail>({ queryKey: qk.newsDetail(slug ?? ''), queryFn: () => api(`/api/news/${slug}`), retry: false, enabled: !!slug });
}
export function useNotes(enabled = true) {
  return useQuery<NotesResponse>({ queryKey: qk.notes, queryFn: () => api('/api/notifications'), enabled });
}
export function useAudit() {
  return useQuery<Paged<AuditItem>>({ queryKey: qk.audit, queryFn: () => api('/api/audit?limit=200'), retry: false });
}
export function useOrgRequests() {
  return useQuery<Paged<OrganizerRequest>>({ queryKey: qk.orgreq, queryFn: () => api('/api/admin/organizer-requests'), retry: false });
}
export function useAdminUsers(q = '', role = '') {
  return useQuery<Paged<AdminUser>>({ queryKey: qk.adminUsers(q, role), queryFn: () => api(`/api/admin/users?q=${encodeURIComponent(q)}&role=${role}`), retry: false });
}
export function usePermCatalog(enabled = true) {
  return useQuery<PermissionMeta[]>({ queryKey: ['perm-catalog'], queryFn: () => api('/api/admin/permissions/catalog'), retry: false, enabled });
}
export function useAdminUserDetail(id: number | null) {
  return useQuery<AdminUserDetail>({ queryKey: ['admin-user', id], queryFn: () => api(`/api/admin/users/${id}`), retry: false, enabled: id != null });
}
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Record<string, unknown> }) =>
      api<AdminUserDetail>(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-user', u.id] });
    },
  });
}
export function useVerify(submitted: string, nonce: number) {
  return useQuery<DocVerify>({ queryKey: qk.verify(submitted, nonce), queryFn: () => api(`/api/documents/verify/${submitted}`), enabled: submitted.length > 0, retry: false });
}
// ---------- mutations (centralized invalidation: no manual F5) ----------
export function invalidateTournament(qc: { invalidateQueries: (f: { queryKey: readonly unknown[] }) => void }, id: string | number) {
  const sid = String(id);
  qc.invalidateQueries({ queryKey: ['t', sid] });
  qc.invalidateQueries({ queryKey: ['regs', sid] });
  qc.invalidateQueries({ queryKey: ['br', sid] });
  qc.invalidateQueries({ queryKey: ['val', sid] });
  qc.invalidateQueries({ queryKey: ['results', sid] });
  qc.invalidateQueries({ queryKey: ['report', sid] });
}

export function useCheckin(tid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: Registration) =>
      api<{ ok: boolean; checked_in: boolean }>(`/api/tournaments/${tid}/check-in/${r.id}`, { method: 'POST', body: JSON.stringify({ checked_in: !r.checked_in }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.regs(tid) }),
  });
}

export function useGenBrackets(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ category_id: number; bracket_id: number; size: number }[]>(`/api/tournaments/${id}/brackets/generate`, { method: 'POST' }),
    onSuccess: () => invalidateTournament(qc, id),
  });
}

export function useGenSchedule(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ scheduled: number; conflict_notifications: number }>(`/api/tournaments/${id}/schedule/generate`, { method: 'POST' }),
    onSuccess: () => invalidateTournament(qc, id),
  });
}

export function useStatusChange(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: TournamentStatus) =>
      api<{ ok: boolean; status: TournamentStatus }>(`/api/tournaments/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: () => invalidateTournament(qc, id),
  });
}

export function useWeighIn(tid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, weigh_in_kg }: { id: number; weigh_in_kg: number }) =>
      api<{ status: string; label: string }>(`/api/tournaments/${tid}/weigh-in/${id}`, { method: 'POST', body: JSON.stringify({ weigh_in_kg }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.regs(tid) }),
  });
}

export type { Category };
