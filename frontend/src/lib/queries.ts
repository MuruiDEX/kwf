/** Domain query layer: stable keys + typed hooks. Keys match the pre-P2
 *  strings exactly so existing caches survive the migration.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { api } from './api';
import type { AthleteCreateBody } from './athletes';
import type {
  AdminUser, AdminUserDetail, Athlete, AthleteDoc, AthleteProfile, AuditItem, Bracket, BracketMatch, Category, Club, ClubDetail, ClubSchedule, ScopedAthlete,
  DocVerify, IssuedDoc, LiveState, MyAssignment, MyAthlete, MyRegistration, NewsDetail, NewsItem, NotesResponse,
  OrganizerRequest, Paged, PermissionMeta, Podium, RankingEntry, RefereeOption, Registration, RegStatus, ReportResponse, ResultsResponse,
  SpravkaTemplate, TatamiAssignment, Tournament, TournamentDetail, TournamentStatus, TrainingGroup, TrainingGroupDetail, TrainingSession, ValidationItem, Ward, WardRegistration, GuardianLinks, MyProfile, CoachDirectoryItem, CoachPublicProfile,
} from '../types/api';
export const qk = {
  me: ['me'],
  // Wave A2: extended filters are appended ONLY when set, so legacy keys
  // ['tournaments'] and ['tournaments', q, status] stay byte-identical.
  // B1: same rule for mine — appended only when true.
  tournaments: (q = '', status = '', city = '', from = '', to = '', mine = false): readonly unknown[] =>
    q || status || city || from || to || mine
      ? city || from || to || mine
        ? ['tournaments', q, status, city, from, to, ...(mine ? ['mine'] : [])]
        : (['tournaments', q, status] as const)
      : (['tournaments'] as const),
  // F-UX-3: qk.search removed (dead code, 0 production references).
  // The single search key lives in lib/search.ts useGlobalSearch:
  // ['search', query, sortedScope, capped]. CommandMenu intentionally
  // uses a direct fetch (no react-query) to avoid warming that cache.
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
  guardianWards: ['guardian-wards'] as const,
  guardianRegs: (id: number | 'all') => ['guardian-regs', id] as const,
  guardianLinks: ['guardian-links'] as const,
  trainingGroups: (clubId: number | 'all', incl = false) =>
    (incl ? (['training-groups', clubId, 'incl'] as const) : (['training-groups', clubId] as const)),
  trainingGroup: (id: number | string) => ['training-group', String(id)] as const,
  athleteGroups: (id: number | string) => ['athlete-groups', String(id)] as const,
  myGroups: ['my-groups'] as const,
  coaches: (q = '', city = '', country = '') =>
    (q || city || country ? (['coaches', q, city, country] as const) : (['coaches'] as const)),
  coach: (id: number | string) => ['coach', String(id)] as const,
  sessions: (clubId: number | 'all', groupId: number | 'all' = 'all') =>
    (['sessions', clubId, groupId] as const),
  myProfile: ['my-profile'] as const,
};

type Opt<T> = Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>;

// ---------- tournaments (Wave A1 filters, Wave A2 URL-driven) ----------
export function useTournaments(q = '', status = '', opt?: Opt<Paged<Tournament>>, extra?: { city?: string; from?: string; to?: string; mine?: boolean }) {
  const city = extra?.city ?? '', from = extra?.from ?? '', to = extra?.to ?? '';
  const mine = extra?.mine ?? false;
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (status) p.set('status', status);
  if (city) p.set('city', city);
  if (from) p.set('date_from', from);
  if (to) p.set('date_to', to);
  if (mine) p.set('mine', 'true');
  const qs = p.toString();
  return useQuery<Paged<Tournament>>({ queryKey: qk.tournaments(q, status, city, from, to, mine), queryFn: () => api(`/api/tournaments${qs ? `?${qs}` : ''}`), ...opt });
}
// B4: paged catalog reads for show-more. Separate key/hook so the legacy
// useTournaments contract (first page, backend default limit) stays
// byte-identical for old consumers (Home, Cabinet). Single slice per
// render (limit = pages * PAGE_SIZE, offset 0) — no duplicates by design.
export function useTournamentsPage(q = '', status = '', extra?: { city?: string; from?: string; to?: string }, limit = 20) {
  const city = extra?.city ?? '', from = extra?.from ?? '', to = extra?.to ?? '';
  const capped = Math.max(1, Math.min(limit, 500));
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (status) p.set('status', status);
  if (city) p.set('city', city);
  if (from) p.set('date_from', from);
  if (to) p.set('date_to', to);
  p.set('limit', String(capped));
  const qs = p.toString();
  return useQuery<Paged<Tournament>>({ queryKey: ['tournaments-page', q, status, city, from, to, capped], queryFn: () => api(`/api/tournaments?${qs}`) });
}
export function usePublicCities(limit = 50) {
  return useQuery<{ items: { city: string; count: number }[] }>({ queryKey: ['public-cities', limit], queryFn: () => api(`/api/public/cities?limit=${limit}`), staleTime: 120_000 });
}
export function usePublicOrganizers(limit = 50) {
  return useQuery<{ items: { name: string; tournaments: number }[] }>({ queryKey: ['public-organizers', limit], queryFn: () => api(`/api/public/organizers?limit=${limit}`), staleTime: 120_000 });
}
export function useTournamentsLive() {
  return useQuery<Paged<Tournament>>({ queryKey: qk.tournamentsLive, queryFn: () => api('/api/tournaments?status=live') });
}
export function useTournament(id: string | undefined, opt?: Opt<TournamentDetail>) {
  return useQuery<TournamentDetail>({ queryKey: qk.tournament(id ?? ''), queryFn: () => api(`/api/tournaments/${id}`), retry: false, enabled: !!id, ...opt });
}
export function useRegs(id: string | undefined, opt?: Opt<Paged<Registration>>, status = '') {
  const qs = status ? `?status=${status}` : '';
  return useQuery<Paged<Registration>>({ queryKey: [...qk.regs(id ?? ''), status], queryFn: () => api(`/api/tournaments/${id}/registrations${qs}`), enabled: !!id, ...opt });
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
// ---------- podium + document registry (Wave 1) ----------
export function usePodium(tid: string) {
  return useQuery<Podium[]>({ queryKey: ['podium', String(tid)], queryFn: () => api(`/api/tournaments/${tid}/podium`) });
}
export function useTournamentDocs(tid: string, enabled = true) {
  return useQuery<IssuedDoc[]>({ queryKey: ['tdocs', String(tid)], queryFn: () => api(`/api/tournaments/${tid}/documents`), retry: false, enabled });
}
export function useReport(tid: string, lang: string) {
  return useQuery<ReportResponse>({ queryKey: qk.report(tid, lang), queryFn: () => api(`/api/tournaments/${tid}/report?lang=${lang}`) });
}

// ---------- people ----------
export function useAthletes(q: string, enabled = true) {
  return useQuery<Paged<Athlete>>({ queryKey: qk.athletes(q), queryFn: () => api(`/api/athletes?q=${encodeURIComponent(q)}`), enabled });
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
// B1: exact birth_year/weight_kg for coach scope or linked self.
// Separate endpoint + key (never merged into the public profile cache).
export function useScopedAthlete(id: string | undefined, enabled = true) {
  return useQuery<ScopedAthlete>({ queryKey: ['scoped-athlete', String(id ?? '')], queryFn: () => api(`/api/athletes/${id}/scoped`), retry: false, enabled: !!id && enabled });
}
// ---------- Wave 2: athlete's public-kind documents ----------
export function useAthleteDocs(id: string | undefined, enabled = true) {
  return useQuery<AthleteDoc[]>({ queryKey: ['athlete-docs', String(id ?? '')], queryFn: () => api(`/api/athletes/${id}/documents`), retry: false, enabled: !!id && enabled });
}
export function useRankings(qs = '') {
  return useQuery<Paged<RankingEntry>>({ queryKey: qk.rankings(qs), queryFn: () => api(`/api/rankings?${qs}`) });
}
export function useClubs(q = '', city = '', country = '') {
  // Coach 2.0 P3: filters append key segments ONLY when set (legacy key stays byte-identical).
  const key = q || city || country
    ? (['clubs', q, city, country] as const)
    : qk.clubs;
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (city) p.set('city', city);
  if (country) p.set('country', country);
  const qs = p.toString();
  return useQuery<Paged<Club>>({ queryKey: key, queryFn: () => api(`/api/clubs${qs ? `?${qs}` : ''}`) });
}
export function useClub(id: string | undefined, athletesLimit = 50) {
  const capped = Math.max(1, Math.min(athletesLimit, 100));
  const key = capped === 50 ? qk.club(id ?? '') : (['club', String(id ?? ''), capped] as const);
  return useQuery<ClubDetail>({ queryKey: key, queryFn: () => api(`/api/clubs/${id}?athletes_limit=${capped}`), retry: false, enabled: !!id });
}
// B2: public club schedule (read-only, future sessions, no note/coach_id).
export function useClubSchedule(id: string | undefined, enabled = true) {
  return useQuery<ClubSchedule>({ queryKey: ['club-schedule', String(id ?? '')], queryFn: () => api(`/api/clubs/${id}/schedule`), retry: false, enabled: !!id && enabled });
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
// ---------- spravki (Wave 1: coach documents) ----------
export function useSpravkiTemplates(lang: string, enabled = true) {
  return useQuery<SpravkaTemplate[]>({ queryKey: ['spravki-templates', lang], queryFn: () => api(`/api/spravki/templates?lang=${lang}`), retry: false, enabled });
}
export function useSpravkiData(athleteId: number | null, tournamentId?: number | null) {
  const qs = `athlete_id=${athleteId}${tournamentId ? `&tournament_id=${tournamentId}` : ''}`;
  return useQuery<Record<string, string>>({ queryKey: ['spravki-data', athleteId, tournamentId ?? 0], queryFn: () => api(`/api/spravki/data?${qs}`), retry: false, enabled: athleteId != null });
}
// ---------- Wave 3: referees, statuses, tournament/category edit ----------
export function useTatamis(tid: string, enabled = true) {
  return useQuery<TatamiAssignment[]>({ queryKey: ['tatamis', String(tid)], queryFn: () => api(`/api/tournaments/${tid}/tatamis`), retry: false, enabled });
}
export function useReferees(enabled = true) {
  return useQuery<RefereeOption[]>({ queryKey: ['referees'], queryFn: () => api('/api/referees'), retry: false, enabled });
}
export function useAssignReferee(tid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tatami_id, referee_id }: { tatami_id: number; referee_id: number | null }) =>
      api<{ ok: boolean }>(`/api/tournaments/${tid}/tatamis/${tatami_id}/referee`, { method: 'POST', body: JSON.stringify({ referee_id }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tatamis', String(tid)] }),
  });
}
export function useMyAssignments(enabled = true) {
  return useQuery<MyAssignment[]>({ queryKey: ['my-assignments'], queryFn: () => api('/api/tournaments/referee/assignments'), retry: false, enabled });
}
export function useUpdateTournament(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api<{ ok: boolean }>(`/api/tournaments/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: () => invalidateTournament(qc, id),
  });
}
export function useCreateCategory(tid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ id: number }>(`/api/tournaments/${tid}/categories`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => invalidateTournament(qc, tid),
  });
}
export function useUpdateCategory(tid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Record<string, unknown> }) =>
      api<{ ok: boolean }>(`/api/tournaments/${tid}/categories/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: () => invalidateTournament(qc, tid),
  });
}
export function useRegStatus(tid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: RegStatus; note?: string }) =>
      api<{ ok: boolean }>(`/api/tournaments/${tid}/registrations/${id}/status`, { method: 'POST', body: JSON.stringify({ status, note: note ?? '' }) }),
    // Wave 7: status flips move rows between filters + athlete's own list.
    onSuccess: () => {
      invalidateTournament(qc, tid);
      qc.invalidateQueries({ queryKey: ['my-regs'] });
    },
  });
}

// ---------- Wave 4: athlete self-service ----------
export function useMyAthleteProfile(enabled = true) {
  return useQuery<MyAthlete | null>({
    queryKey: ['my-athlete'], queryFn: () => api('/api/me/athlete'), retry: false, enabled,
  });
}
export function useMyRegistrations(enabled = true) {
  return useQuery<MyRegistration[]>({ queryKey: ['my-regs'], queryFn: () => api('/api/me/registrations'), retry: false, enabled });
}
export function useClaimAthlete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ ok: boolean }>(`/api/athletes/${id}/claim`, { method: 'POST' }),
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: ['my-athlete'] });
      qc.invalidateQueries({ queryKey: ['my-regs'] });
      qc.invalidateQueries({ queryKey: ['athlete', String(id)] });
    },
  });
}
export function useBulkRegStatus(tid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status, note }: { ids: number[]; status: RegStatus; note?: string }) =>
      api<{ updated: number[]; errors: { id: number; error: string }[] }>(
        `/api/tournaments/${tid}/registrations/bulk-status`, { method: 'POST', body: JSON.stringify({ ids, status, note: note ?? '' }) }),
    onSuccess: () => {
      invalidateTournament(qc, tid);
      qc.invalidateQueries({ queryKey: ['my-regs'] });
    },
  });
}
// ---------- D2 P1: athlete creation (coach cabinet; scope enforced server-side) ----------
export function useCreateAthlete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AthleteCreateBody) =>
      api<{ id: number }>('/api/athletes', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (_r, body) => {
      qc.invalidateQueries({ queryKey: ['my-athletes'] });
      qc.invalidateQueries({ queryKey: ['athletes'] });
      qc.invalidateQueries({ queryKey: ['rankings'] });
      if (body.club_id != null) qc.invalidateQueries({ queryKey: qk.club(body.club_id) });
    },
  });
}
// ---------- D2 P2: training groups (coach squads; manage = club owner) ----------
export function useClubGroups(clubId: number | null, enabled = true, includeInactive = false) {
  const qs = clubId != null
    ? `/api/groups?club_id=${clubId}${includeInactive ? '&include_inactive=true' : ''}`
    : '/api/groups';
  return useQuery<TrainingGroup[]>({
    queryKey: qk.trainingGroups(clubId ?? 'all', includeInactive),
    queryFn: () => api(qs),
    retry: false, enabled,
  });
}
export function useGroup(gid: number | null, enabled = true) {
  return useQuery<TrainingGroupDetail>({
    queryKey: qk.trainingGroup(gid ?? ''), queryFn: () => api(`/api/groups/${gid}`),
    retry: false, enabled: gid != null && enabled,
  });
}
/** Athlete P1: squads containing one athlete (public roster shape). */
export function useAthleteGroups(athleteId: number | null, enabled = true) {
  return useQuery<TrainingGroup[]>({
    queryKey: qk.athleteGroups(athleteId ?? ''), queryFn: () => api(`/api/groups?athlete_id=${athleteId}`),
    retry: false, enabled: athleteId != null && enabled,
  });
}
function invalidateGroups(qc: ReturnType<typeof useQueryClient>, clubId?: number | null, gid?: number | null) {
  qc.invalidateQueries({ queryKey: ['training-groups'] });
  if (gid != null) qc.invalidateQueries({ queryKey: qk.trainingGroup(gid) });
  if (clubId != null) qc.invalidateQueries({ queryKey: qk.club(clubId) });
}
export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<TrainingGroup>('/api/groups', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (g) => invalidateGroups(qc, g.club_id),
  });
}
export function useUpdateGroup(gid: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api<TrainingGroup>(`/api/groups/${gid}`, { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: (g) => invalidateGroups(qc, g.club_id, gid),
  });
}
export function useGroupMember(gid: number) {
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: (athlete_id: number) =>
      api<unknown>(`/api/groups/${gid}/members`, { method: 'POST', body: JSON.stringify({ athlete_id }) }),
    onSuccess: () => invalidateGroups(qc, undefined, gid),
  });
  const remove = useMutation({
    mutationFn: (athlete_id: number) =>
      api<unknown>(`/api/groups/${gid}/members/${athlete_id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateGroups(qc, undefined, gid),
  });
  return { add, remove };
}
// ---------- C3: guardian cabinet (approved wards, read-only) ----------
// Visibility is data-driven (no guardian role exists): an empty list means
// "not a guardian", never a role check. retry:false like other protected
// queries so 403/404 surfaces as error state instead of retry storms.
export function useGuardianWards(enabled = true) {
  // C5: authorization-sensitive — never serve a stale ward list across
  // remounts (a revoked ward must revalidate, not render from cache).
  return useQuery<Ward[]>({ queryKey: qk.guardianWards, queryFn: () => api('/api/guardian/athletes'), retry: false, enabled, staleTime: 0 });
}
export function useGuardianRegs(athleteId: number | null, enabled = true) {
  const key = athleteId ?? 'all';
  const qs = athleteId != null ? `?athlete_id=${athleteId}` : '';
  // C5: same as above — revoked wards must fail the refetch, not read cache.
  return useQuery<WardRegistration[]>({ queryKey: qk.guardianRegs(key), queryFn: () => api(`/api/guardian/registrations${qs}`), retry: false, enabled, staleTime: 0 });
}
/** Guardian 2.0: own outgoing + actionable incoming links (lifecycle UI). */
export function useGuardianLinks(enabled = true) {
  return useQuery<GuardianLinks>({ queryKey: qk.guardianLinks, queryFn: () => api('/api/guardian/links'), retry: false, enabled, staleTime: 0 });
}
export function useGuardianLinkAction() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.guardianLinks });
    qc.invalidateQueries({ queryKey: qk.guardianWards });
    qc.invalidateQueries({ queryKey: ['guardian-regs'] });
  };
  return useMutation({
    mutationFn: ({ lid, action }: { lid: number; action: 'approve' | 'reject' }) =>
      api<unknown>(`/api/guardian/links/${lid}/${action}`, { method: 'POST' }),
    onSuccess: refresh,
  });
}
export function useGuardianRevoke() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.guardianLinks });
    qc.invalidateQueries({ queryKey: qk.guardianWards });
    qc.invalidateQueries({ queryKey: ['guardian-regs'] });
  };
  return useMutation({
    mutationFn: (lid: number) => api<unknown>(`/api/guardian/links/${lid}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
}
// ---------- multi-role: coach training schedule ----------

export function useSessions(clubId: number | null, enabled = true, groupId: number | null = null) {
  const qs = clubId != null
    ? `?club_id=${clubId}${groupId != null ? `&group_id=${groupId}` : ''}`
    : '';
  return useQuery<Paged<TrainingSession>>({ queryKey: qk.sessions(clubId ?? 'all', groupId ?? 'all'), queryFn: () => api(`/api/schedule${qs}`), retry: false, enabled });
}
export function useSaveSession() {
  const qc = useQueryClient();
  const refresh = (body?: Record<string, unknown>) => {
    qc.invalidateQueries({ queryKey: ['sessions'] });
    const gid = body?.group_id;
    if (typeof gid === 'number') qc.invalidateQueries({ queryKey: qk.trainingGroup(gid) });
  };
  return useMutation({
    mutationFn: ({ id, body }: { id: number | null; body: Record<string, unknown> }) =>
      api<{ id: number }>(id == null ? '/api/schedule' : `/api/schedule/${id}`,
        id == null
          ? { method: 'POST', body: JSON.stringify(body) }
          : { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (_r, vars) => refresh(vars.body),
  });
}
export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ ok: boolean }>(`/api/schedule/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['training-group'] });
    },
  });
}
// ---------- Wave 6: controlled bracket correction ----------
export function useCorrectMatch(tid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, athlete_a_id, athlete_b_id, reason }: { id: number; athlete_a_id: number; athlete_b_id: number; reason: string }) =>
      api<{ ok: boolean; match: BracketMatch }>(
        `/api/tournaments/matches/${id}/correct`, { method: 'POST', body: JSON.stringify({ athlete_a_id, athlete_b_id, reason }) }),
    onSuccess: () => {
      // Wave 7: a corrected pair reshapes future results/podium — refresh them too.
      invalidateTournament(qc, tid);
      qc.invalidateQueries({ queryKey: ['podium', String(tid)] });
      qc.invalidateQueries({ queryKey: ['tdocs', String(tid)] });
    },
  });
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
    // Wave 7: check-in shifts validation + header counts too.
    onSuccess: () => invalidateTournament(qc, tid),
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
    // Wave 7: weigh-in shifts validation + header counts too.
    onSuccess: () => invalidateTournament(qc, tid),
  });
}

// ---------- Wave 1: move registration between categories ----------
export function useMoveReg(tid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, category_id }: { id: number; category_id: number }) =>
      api<{ ok: boolean; category_id: number; weigh_in_status: string; warnings: string[] }>(
        `/api/tournaments/${tid}/registrations/${id}/move`, { method: 'POST', body: JSON.stringify({ category_id }) }),
    onSuccess: () => invalidateTournament(qc, tid),
  });
}

export type { Category };
// ---------- Coach 2.0 P3: public directory + profile (allowlisted reads) ----------
export function useCoaches(q = '', city = '', country = '', enabled = true) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (city) p.set('city', city);
  if (country) p.set('country', country);
  const qs = p.toString();
  return useQuery<Paged<CoachDirectoryItem>>({
    queryKey: qk.coaches(q, city, country),
    queryFn: () => api(`/api/coaches${qs ? `?${qs}` : ''}`), retry: false, enabled,
  });
}
export function useCoachProfile(id: string | undefined) {
  return useQuery<CoachPublicProfile>({
    queryKey: qk.coach(id ?? ''), queryFn: () => api(`/api/coaches/${id}`),
    retry: false, enabled: !!id,
  });
}
export function useMyGroups(enabled = true) {
  return useQuery<TrainingGroup[]>({
    queryKey: qk.myGroups, queryFn: () => api('/api/groups/mine'), retry: false, enabled,
  });
}
// ---------- Coach 2.0 P1: self profile + avatar ----------
export function useMyProfile(enabled = true) {
  return useQuery<MyProfile>({ queryKey: qk.myProfile, queryFn: () => api('/api/auth/profile'), retry: false, enabled });
}
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<MyProfile>('/api/auth/profile', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.myProfile });
      qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}
export function useAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api<{ ok: boolean; avatar: string }>('/api/auth/avatar', { method: 'POST', body: fd });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.myProfile });
    },
  });
}
// ---------- Coach 2.0 P2: club self-create + management ----------
export function useCreateOwnClub() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ id: number }>('/api/clubs/self', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-clubs'] });
      qc.invalidateQueries({ queryKey: qk.clubs });
    },
  });
}
export function useUpdateClub(cid: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api<{ ok: boolean }>(`/api/clubs/${cid}`, { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.club(cid) });
      qc.invalidateQueries({ queryKey: ['my-clubs'] });
      qc.invalidateQueries({ queryKey: qk.clubs });
    },
  });
}
export function useTransferClub(cid: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (new_owner_id: number) =>
      api<{ ok: boolean }>(`/api/clubs/${cid}/transfer`, { method: 'PUT', body: JSON.stringify({ new_owner_id }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.club(cid) });
      qc.invalidateQueries({ queryKey: ['my-clubs'] });
    },
  });
}
export function useClubLogo(cid: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api<{ ok: boolean; logo: string }>(`/api/clubs/${cid}/logo`, { method: 'POST', body: fd });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.club(cid) });
    },
  });
}
