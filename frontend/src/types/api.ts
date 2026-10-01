/** KWF API types — mirror backend responses (FastAPI + Pydantic schemas + hand-built dicts).
 *  P1 envelope: { items, total, limit, offset } for all pure-list GETs.
 *  Notifications keep { unread, items, total, limit, offset }.
 */

export type TournamentStatus = 'upcoming' | 'registration' | 'live' | 'finished';
export type WeighInStatus = 'pending' | 'ok' | 'over' | 'under';
export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'bye';
export type Gender = 'male' | 'female';
export type Role = 'public' | 'athlete' | 'coach' | 'referee' | 'organizer' | 'admin';
export type FinishOutcome = 'finished' | 'repeated' | 'corrected';

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Tournament {
  id: number;
  name: string;
  city: string;
  country: string;
  organization: string;
  start_date: string;
  status: TournamentStatus;
  type: string;
  tatami_count: number;
  participants: number;
  created_by: number | null;
}

export interface Category {
  id: number;
  name: string;
  gender: Gender;
  age_min: number;
  age_max: number;
  weight_min: number;
  weight_max: number;
}

export interface TournamentDetail extends Tournament {
  categories: Category[];
}

export interface Registration {
  id: number;
  athlete_id: number;
  athlete: string;
  category_id: number;
  seed: number | null;
  checked_in: boolean;
  /** Exact weight is PII: null for anonymous readers (P0). */
  weigh_in_kg: number | null;
  weigh_in_status: WeighInStatus;
}

export interface BracketMatch {
  id: number;
  round: number;
  pos: number;
  a: number | null;
  b: number | null;
  winner: number | null;
  status: MatchStatus;
  tatami_id: number | null;
  scheduled_at: string | null;
  score_a: number;
  score_b: number;
  next: number | null;
}

export interface Bracket {
  id: number;
  category_id: number;
  size: number;
  matches: BracketMatch[];
}

export interface ValidationItem {
  key: string;
  ok: boolean;
  message: string;
  suggestion?: string;
  level?: string;
  count?: number;
  items?: ConflictItem[];
}

export interface ConflictItem {
  message: string;
  suggestion?: string;
  [k: string]: unknown;
}

export interface TimerState {
  action: 'running' | 'paused' | 'idle';
  duration_sec: number;
  ends_at: number | null;
  remaining_sec?: number;
  updated_at: number;
  match_id: number;
}

export interface LiveFight {
  id: number;
  a: number | null;
  b: number | null;
  a_name: string | null;
  b_name: string | null;
  tatami_id: number | null;
  status: MatchStatus;
  timer: TimerState | null;
}

export interface LiveState {
  live: LiveFight[];
  queue: LiveFight[];
}

export type LiveEvent =
  | { type: 'fight_finished'; match_id: number; winner: number; score_a: number; score_b: number }
  | ({ type: 'timer' } & Partial<TimerState> & { match_id: number });

export interface FinishResult {
  ok: boolean;
  winner: number;
  next: number | null;
  outcome: FinishOutcome;
}

export interface Athlete {
  id: number;
  name: string;
  club_id: number | null;
  country: string;
  points: number;
  wins: number;
  losses: number;
  weight: number;
}

export interface AthleteHistoryItem {
  tournament_id: number;
  tournament: string;
  date: string;
  category: string;
  result: 'champion' | 'finalist' | 'semifinalist' | 'participant' | 'registered';
}

export interface AthleteProfile extends Omit<Athlete, 'club_id'> {
  first_name: string;
  last_name: string;
  gender: Gender;
  birth_year: number;
  level: string;
  club: string;
  club_id: number | null;
  history: AthleteHistoryItem[];
}

export interface Club {
  id: number;
  name: string;
  country: string;
  city: string;
  coach: string;
}

export interface ClubDetail extends Club {
  athletes: Pick<Athlete, 'id' | 'name' | 'points' | 'wins' | 'losses'>[];
  titles: number;
}

export interface RankingEntry {
  rank: number;
  id: number;
  name: string;
  club_id: number | null;
  weight: number;
  points: number;
  wins: number;
  losses: number;
}

export interface NewsItem {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  category: string;
}

export interface NewsDetail extends NewsItem {
  body: string;
  created_at: string;
}

export interface Standing {
  category_id: number;
  category: string;
  champion_id: number | null;
  champion: string;
  finalists: string[];
}

export interface MedalRow {
  athlete_id: number;
  athlete: string;
  club: string;
  gold: number;
  titles: string[];
}

export interface ResultsResponse {
  tournament: string;
  standings: Standing[];
  medal_table: MedalRow[];
}

export interface ReportStats {
  participants: number;
  countries: number;
  clubs: number;
  fights_total: number;
  fights_finished: number;
  club_gold: [string, number][];
}

export interface ReportResponse {
  tournament: string;
  stats: ReportStats;
  standings: Standing[];
  markdown: string;
}

export interface DocVerify {
  valid: boolean;
  code?: string;
  kind?: string;
  athlete?: string;
  tournament?: string;
  date?: string;
  place?: string;
  category?: string;
}

export interface KwfNotification {
  id: number;
  type: string;
  message: string;
  link: string;
  is_read: boolean;
  at: string;
}

export interface NotesResponse {
  unread: number;
  items: KwfNotification[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditItem {
  id: number;
  actor: number | null;
  action: string;
  entity: string;
  entity_id: number | null;
  at: string;
}

export interface AdminUser {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  grants?: string[];
}

export type PermissionKey =
  | 'tournaments.create' | 'tournaments.manage' | 'tournaments.manage_all'
  | 'athletes.manage' | 'clubs.manage' | 'news.manage' | 'documents.manage'
  | 'matches.manage' | 'users.view' | 'audit.view'
  | 'roles.manage' | 'organizer_requests.manage';

export interface PermissionMeta {
  key: PermissionKey;
  group: string;
  roles: Role[];
  grantable: boolean;
}

export interface AdminUserDetail extends AdminUser {
  grants: string[];
  effective: string[];
}

export interface MyPermissions {
  role: Role;
  permissions: string[];
}

export interface OrganizerRequest {
  id: number;
  user: string;
  email: string;
  org_name: string;
  message: string;
  at: string;
}

export interface Me {
  id: number;
  email: string;
  role: Role;
  full_name: string;
}

export interface SearchResult {
  athletes: { id: number; name: string }[];
  clubs: { id: number; name: string }[];
}
