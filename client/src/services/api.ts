export interface ApiHealth {
  status: "ok";
  service: string;
  timestamp: string;
}

export interface UserRecord {
  id: string;
  steamId: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  createdAt: string;
  lastSeenAt: string;
}

export type UserRole = "player" | "admin" | "superadmin";

export const isStaff = (user: UserRecord) => user.role === "admin" || user.role === "superadmin";

export const roleLabel: Record<UserRole, string> = { player: "JOGADOR", admin: "ADMIN", superadmin: "SUPER ADMIN" };

export interface PresenceEntry {
  steamId: string;
  displayName: string;
  lastSeenAt: string;
}

export interface MatchPlayer {
  userId: string;
  steamId: string;
  displayName: string;
  avatarUrl: string | null;
  team: "a" | "b" | null;
  joinedAt: string;
}

export type MatchFormat = "bo1" | "bo3";
export type MatchPhase = "lobby" | "veto" | "live" | "finished";

export interface VetoRecord {
  id: string;
  matchId: string;
  seq: number;
  action: "ban" | "pick" | "side";
  mapName: string | null;
  team: "a" | "b" | null;
  actorSteamId: string;
  actorName: string;
  createdAt: string;
}

export interface MatchRecord {
  id: string;
  name: string;
  mapName: string;
  teamAName: string;
  teamBName: string;
  maxRounds: number;
  format: MatchFormat;
  mapPool: string[];
  phase: MatchPhase;
  captainAId: string | null;
  captainBId: string | null;
  sideChoice: "a" | "b" | null;
  status: "scheduled" | "live" | "finished" | "cancelled";
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  matchNumber: number;
  knifeRound: boolean;
  preset: MatchPreset;
  overtime: boolean;
  overtimeRounds: number;
  playout: boolean;
  serverState: ServerState;
  serverError: string | null;
  live: LiveState;
  players?: MatchPlayer[];
  vetoes?: VetoRecord[];
}

export type MatchPreset = "official" | "official_noknife" | "quick" | "scrim" | "custom";

export type ServerState = "idle" | "loading" | "warmup" | "live" | "paused" | "map_end" | "finished" | "error";

export interface LivePlayer {
  steamId: string;
  name: string;
  team: "a" | "b";
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  headshotKills: number;
}

export interface LiveKill {
  round: number;
  attacker: string | null;
  attackerTeam: "a" | "b" | null;
  victim: string;
  victimTeam: "a" | "b" | null;
  weapon: string;
  headshot: boolean;
  at: string;
}

export interface LiveState {
  mapNumber?: number;
  mapName?: string;
  round?: number;
  scoreA?: number;
  scoreB?: number;
  seriesA?: number;
  seriesB?: number;
  paused?: boolean;
  winner?: "a" | "b" | null;
  maps?: { mapName: string; scoreA: number; scoreB: number; winner: "a" | "b" | null }[];
  players?: LivePlayer[];
  feed?: LiveKill[];
  updatedAt?: string;
}

export interface RealtimeEvent {
  type: "match" | "matches" | "presence" | "invites";
  matchId?: string;
}

export interface InviteRecord {
  id: string;
  matchId: string;
  matchName: string;
  inviterName: string;
  status: string;
  createdAt: string;
}

export interface CreateMatchInput {
  name: string;
  mapName: string;
  teamAName: string;
  teamBName: string;
  maxRounds: number;
  format: MatchFormat;
  mapPool: string[];
  knifeRound: boolean;
  preset: MatchPreset;
  overtime: boolean;
  overtimeRounds: number;
  playout: boolean;
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/+$/, "");

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.code || "API request failed");
  }
  return response.json() as Promise<T>;
};

const parseApiHealth = (value: unknown): ApiHealth => {
  if (typeof value !== "object" || value === null) throw new Error("Unexpected API response");
  const p = value as Record<string, unknown>;
  if (p.status !== "ok" || typeof p.service !== "string" || typeof p.timestamp !== "string" || Number.isNaN(Date.parse(p.timestamp))) {
    throw new Error("Unexpected API response");
  }
  return { status: "ok", service: p.service, timestamp: p.timestamp };
};

export const getApiHealth = async (signal?: AbortSignal): Promise<ApiHealth> =>
  parseApiHealth(await request<ApiHealth>("/health", { signal }));

export const getMe = async (signal?: AbortSignal): Promise<UserRecord | null> => {
  const response = await fetch(`${apiBaseUrl}/auth/me`, { credentials: "include", signal });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("API request failed");
  const payload = (await response.json()) as { user: UserRecord };
  return payload.user;
};

export const logout = () => request<{ loggedOut: boolean }>("/auth/logout", { method: "POST" });

export const getPresence = (signal?: AbortSignal) =>
  request<{ site: PresenceEntry[]; server: PresenceEntry[] }>("/presence", { signal });

export const listMatches = (signal?: AbortSignal) =>
  request<{ matches: MatchRecord[] }>("/matches", { signal });

export const createMatch = (input: CreateMatchInput) =>
  request<{ match: MatchRecord }>("/matches", { method: "POST", body: JSON.stringify(input) });

export const joinMatch = (matchId: string) =>
  request<{ joined: boolean }>(`/matches/${matchId}/join`, { method: "POST" });

export const inviteToMatch = (matchId: string, steamId: string) =>
  request<{ invited: boolean }>(`/matches/${matchId}/invites`, { method: "POST", body: JSON.stringify({ steamId }) });

export const startVeto = (matchId: string, captainBSteamId?: string) =>
  request<{ started: boolean }>(`/matches/${matchId}/veto/start`, {
    method: "POST",
    body: JSON.stringify(captainBSteamId ? { captainBSteamId } : {}),
  });

export const sendVeto = (matchId: string, payload: { action: "ban" | "pick"; mapName: string } | { action: "side"; side: "a" | "b" }) =>
  request<{ accepted?: boolean; finished?: boolean }>(`/matches/${matchId}/veto`, { method: "POST", body: JSON.stringify(payload) });

export const getMatch = (matchId: string, signal?: AbortSignal) =>
  request<{ match: MatchRecord; connectAddress: string | null }>(`/matches/${matchId}`, { signal });

export const deleteMatch = (matchId: string) =>
  request<{ deleted: boolean }>(`/matches/${matchId}`, { method: "DELETE" });

export const loadMatchOnServer = (matchId: string) =>
  request<{ loading: boolean }>(`/matches/${matchId}/server/load`, { method: "POST" });

export const endMatchOnServer = (matchId: string) =>
  request<{ ended: boolean }>(`/matches/${matchId}/server/end`, { method: "POST" });

export interface DynamicPlayer {
  steamId: string;
  name: string;
  avatarUrl: string | null;
  registered: boolean;
}

export interface DynamicStartInput {
  name?: string;
  teamAName: string;
  teamBName: string;
  teamA: string[];
  teamB: string[];
  maps: string[];
  format: MatchFormat;
  preset: MatchPreset;
  maxRounds: number;
  knifeRound: boolean;
  overtime: boolean;
  overtimeRounds: number;
  playout: boolean;
  force?: boolean;
}

export const getDynamicPlayers = (signal?: AbortSignal) =>
  request<{ players: DynamicPlayer[]; activeMatch: { id: string; name: string; serverState: ServerState } | null }>("/dynamic/players", { signal });

export const startDynamicMatch = (input: DynamicStartInput) =>
  request<{ matchId: string; loading: boolean; error: string | null }>("/dynamic/start", { method: "POST", body: JSON.stringify(input) });

export const subscribeRealtime = (onEvent: (event: RealtimeEvent) => void, onStatus?: (connected: boolean) => void) => {
  const source = new EventSource(`${apiBaseUrl}/stream`, { withCredentials: true });
  source.onopen = () => onStatus?.(true);
  source.onerror = () => onStatus?.(false);
  source.onmessage = (message) => {
    try { onEvent(JSON.parse(message.data) as RealtimeEvent); } catch { onStatus?.(true); }
  };
  return () => source.close();
};

export const setTeam = (matchId: string, team: "a" | "b") =>
  request<{ joined: boolean; team: string }>(`/matches/${matchId}/team`, { method: "POST", body: JSON.stringify({ team }) });

export const shuffleTeams = (matchId: string) =>
  request<{ shuffled: boolean }>(`/matches/${matchId}/shuffle`, { method: "POST" });

export const listUsers = (signal?: AbortSignal) =>
  request<{ users: UserRecord[] }>("/staff/users", { signal });

export const setUserRole = (steamId: string, role: "player" | "admin") =>
  request<{ steamId: string; role: UserRole }>(`/staff/users/${steamId}/role`, { method: "POST", body: JSON.stringify({ role }) });

export const listInvites = (signal?: AbortSignal) =>
  request<{ invites: InviteRecord[] }>("/invites", { signal });

export const respondInvite = (inviteId: string, accept: boolean) =>
  request<{ responded: boolean }>(`/invites/${inviteId}/respond`, { method: "POST", body: JSON.stringify({ accept }) });
