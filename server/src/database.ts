import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolConfig, type QueryResultRow } from "pg";

export type MatchFormat = "bo1" | "bo3";
export type MatchPhase = "lobby" | "veto" | "live" | "finished";

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
  utilityDamage: number;
  enemiesFlashed: number;
  friendliesFlashed: number;
  flashAssists: number;
  teamKills: number;
  suicides: number;
  knifeKills: number;
  roundsPlayed: number;
  bombPlants: number;
  bombDefuses: number;
  kills1: number;
  kills2: number;
  kills3: number;
  kills4: number;
  kills5: number;
  oneV1: number;
  oneV2: number;
  oneV3: number;
  oneV4: number;
  oneV5: number;
  firstKills: number;
  firstDeaths: number;
  tradeKills: number;
  kast: number;
  score: number;
  mvps: number;
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
  totals?: LivePlayer[];
  feed?: LiveKill[];
  updatedAt?: string;
}

export interface CreateMatchInput {
  name: string;
  mapName: string;
  teamAName: string;
  teamBName: string;
  maxRounds: number;
  format?: MatchFormat;
  mapPool?: string[];
  knifeRound?: boolean;
  preset?: MatchPreset;
  overtime?: boolean;
  overtimeRounds?: number;
  playout?: boolean;
  createdBy?: string | null;
}

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

export type UserRole = "player" | "admin" | "superadmin";

export interface UserRecord {
  id: string;
  steamId: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  createdAt: string;
  lastSeenAt: string;
}

export interface SessionUser {
  user: UserRecord;
  sessionId: string;
}

export interface PresenceEntry {
  steamId: string;
  displayName: string;
  lastSeenAt: string;
}

export interface MatchPlayerRecord {
  userId: string;
  steamId: string;
  displayName: string;
  avatarUrl: string | null;
  team: "a" | "b" | null;
  joinedAt: string;
}

export interface InviteRecord {
  id: string;
  matchId: string;
  matchName: string;
  inviterName: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
}

export interface HeartbeatPlayer {
  steamId: string;
  name: string;
}

export interface MatchStore {
  ping(): Promise<void>;
  migrate(): Promise<void>;
  listMatches(): Promise<MatchRecord[]>;
  createMatch(input: CreateMatchInput): Promise<MatchRecord>;
  upsertSteamUser(steamId: string): Promise<UserRecord>;
  updateUserProfile(steamId: string, displayName: string, avatarUrl: string | null): Promise<void>;
  findUserBySteamId(steamId: string): Promise<UserRecord | null>;
  listUsers(): Promise<UserRecord[]>;
  setUserRole(steamId: string, role: UserRole): Promise<void>;
  promoteSuperAdmins(steamIds: string[]): Promise<void>;
  getMatchById(matchId: string): Promise<MatchRecord | null>;
  getMatchByNumber(matchNumber: number): Promise<MatchRecord | null>;
  deleteMatch(matchId: string): Promise<void>;
  findActiveServerMatch(): Promise<MatchRecord | null>;
  setServerState(matchId: string, state: ServerState, error?: string | null): Promise<void>;
  setLive(matchId: string, live: LiveState): Promise<void>;
  setMatchPhase(matchId: string, phase: MatchPhase): Promise<void>;
  setMatchCaptains(matchId: string, captainAId: string | null, captainBId: string | null): Promise<void>;
  setMatchSide(matchId: string, side: "a" | "b"): Promise<void>;
  insertVeto(veto: Omit<VetoRecord, "id" | "createdAt">): Promise<void>;
  listVetoes(matchId: string): Promise<VetoRecord[]>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findSessionUser(tokenHash: string): Promise<SessionUser | null>;
  touchSession(sessionId: string): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  listOnlineUsers(withinSeconds: number): Promise<PresenceEntry[]>;
  reportServerPlayers(players: HeartbeatPlayer[]): Promise<void>;
  replaceServerPlayers(players: HeartbeatPlayer[]): Promise<void>;
  listServerPlayers(withinSeconds: number): Promise<PresenceEntry[]>;
  joinMatch(matchId: string, userId: string): Promise<void>;
  setPlayerTeam(matchId: string, userId: string, team: "a" | "b"): Promise<void>;
  listMatchPlayers(matchId: string): Promise<MatchPlayerRecord[]>;
  createInvite(matchId: string, inviterId: string, inviteeSteamId: string): Promise<void>;
  listInvitesForUser(userId: string): Promise<InviteRecord[]>;
  respondInvite(inviteId: string, userId: string, accept: boolean): Promise<void>;
  getEloBySteamIds(steamIds: string[]): Promise<Map<string, number>>;
  recordMatchResult(result: MatchResultInput): Promise<boolean>;
  getMatchResult(matchId: string): Promise<MatchResultRecord | null>;
  listMatchHistory(limit: number, steamId?: string): Promise<MatchHistoryEntry[]>;
  listRankings(limit: number): Promise<RankingEntry[]>;
  getPlayerProfile(steamId: string): Promise<PlayerProfile | null>;
}

export interface PlayerMatchStats extends LivePlayer {
  won: boolean;
  eloBefore: number | null;
  eloAfter: number | null;
}

export interface MatchResultInput {
  matchId: string;
  winner: "a" | "b" | null;
  scoreA: number;
  scoreB: number;
  rounds: number;
  mapName: string;
  mvpSteamId: string | null;
  worstSteamId: string | null;
  players: PlayerMatchStats[];
}

export interface MatchResultRecord extends Omit<MatchResultInput, "players"> {
  finishedAt: string;
  players: PlayerMatchStats[];
}

export interface MatchHistoryEntry {
  matchId: string;
  name: string;
  teamAName: string;
  teamBName: string;
  mapName: string;
  format: MatchFormat;
  winner: "a" | "b" | null;
  scoreA: number;
  scoreB: number;
  mvpName: string | null;
  finishedAt: string;
  player?: { team: "a" | "b"; kills: number; deaths: number; assists: number; won: boolean; eloDelta: number | null };
}

export interface RankingEntry {
  steamId: string;
  displayName: string;
  avatarUrl: string | null;
  elo: number;
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  headshotKills: number;
  damage: number;
  rounds: number;
}

export interface PlayerProfile extends RankingEntry {
  assists: number;
  mvps: number;
  maps: { mapName: string; matches: number; wins: number }[];
  eloHistory: { at: string; elo: number }[];
}

type Row = QueryResultRow;

const iso = (v: unknown) => new Date(v as string | Date).toISOString();

const toMatch = (r: Row): MatchRecord => ({
  id: r.id, name: r.name, mapName: r.map_name, teamAName: r.team_a_name, teamBName: r.team_b_name,
  maxRounds: r.max_rounds, format: r.format ?? "bo1", mapPool: r.map_pool ?? [], phase: r.phase ?? "lobby",
  captainAId: r.captain_a_id ?? null, captainBId: r.captain_b_id ?? null, sideChoice: r.side_choice ?? null,
  status: r.status, createdBy: r.created_by ?? null,
  createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  matchNumber: Number(r.match_number ?? 0), knifeRound: r.knife_round ?? true,
  preset: r.preset ?? "official", overtime: r.overtime ?? true, overtimeRounds: r.overtime_rounds ?? 6, playout: r.playout ?? false,
  serverState: r.server_state ?? "idle", serverError: r.server_error ?? null, live: r.live ?? {},
});

const toUser = (r: Row): UserRecord => ({
  id: r.id, steamId: r.steam_id, displayName: r.display_name, avatarUrl: r.avatar_url ?? null, role: r.role,
  createdAt: iso(r.created_at), lastSeenAt: iso(r.last_seen_at),
});

const toVeto = (r: Row): VetoRecord => ({
  id: r.id, matchId: r.match_id, seq: r.seq, action: r.action, mapName: r.map_name ?? null, team: r.team ?? null,
  actorSteamId: r.actor_steam_id, actorName: r.actor_name, createdAt: iso(r.created_at),
});

export class PostgresDatabase implements MatchStore {
  private readonly pool: Pool;

  constructor(configuration: PoolConfig) {
    this.pool = new Pool({ ...configuration, max: 5, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000 });
    this.pool.on("error", (error) => console.error(`[database] idle client error (${error.name})`));
  }

  async ping(): Promise<void> { await this.pool.query("SELECT 1"); }

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        steam_id TEXT NOT NULL UNIQUE CHECK (steam_id ~ '^[0-9]{17}$'),
        display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 64),
        role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('player', 'admin', 'superadmin'));
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS sessions_seen_idx ON sessions (last_seen_at);
      CREATE TABLE IF NOT EXISTS matches (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
        map_name TEXT NOT NULL CHECK (char_length(map_name) BETWEEN 1 AND 40),
        team_a_name TEXT NOT NULL CHECK (char_length(team_a_name) BETWEEN 1 AND 64),
        team_b_name TEXT NOT NULL CHECK (char_length(team_b_name) BETWEEN 1 AND 64),
        max_rounds INTEGER NOT NULL CHECK (max_rounds BETWEEN 1 AND 30),
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'finished', 'cancelled')),
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'bo1' CHECK (format IN ('bo1', 'bo3'));
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS map_pool TEXT[] NOT NULL DEFAULT '{}';
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'lobby' CHECK (phase IN ('lobby', 'veto', 'live', 'finished'));
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS captain_a_id UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS captain_b_id UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS side_choice TEXT CHECK (side_choice IN ('a', 'b'));
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_number BIGSERIAL;
      CREATE UNIQUE INDEX IF NOT EXISTS matches_number_idx ON matches (match_number);
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS knife_round BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS server_state TEXT NOT NULL DEFAULT 'idle';
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS server_error TEXT;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS live JSONB NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS preset TEXT NOT NULL DEFAULT 'official';
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS overtime BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS overtime_rounds INTEGER NOT NULL DEFAULT 6;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS playout BOOLEAN NOT NULL DEFAULT false;
      CREATE TABLE IF NOT EXISTS match_vetoes (
        id UUID PRIMARY KEY,
        match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('ban', 'pick', 'side')),
        map_name TEXT,
        team TEXT CHECK (team IN ('a', 'b')),
        actor_steam_id TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS match_players (
        match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        team TEXT CHECK (team IN ('a', 'b')),
        joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (match_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS match_invites (
        id UUID PRIMARY KEY,
        match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invitee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (match_id, invitee_id)
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS elo INTEGER NOT NULL DEFAULT 1000;
      CREATE TABLE IF NOT EXISTS match_results (
        match_id UUID PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
        winner TEXT CHECK (winner IN ('a', 'b')),
        score_a INTEGER NOT NULL,
        score_b INTEGER NOT NULL,
        rounds INTEGER NOT NULL,
        map_name TEXT NOT NULL,
        mvp_steam_id TEXT,
        finished_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS match_player_stats (
        match_id UUID NOT NULL REFERENCES match_results(match_id) ON DELETE CASCADE,
        steam_id TEXT NOT NULL,
        name TEXT NOT NULL,
        team TEXT NOT NULL CHECK (team IN ('a', 'b')),
        kills INTEGER NOT NULL,
        deaths INTEGER NOT NULL,
        assists INTEGER NOT NULL,
        damage INTEGER NOT NULL,
        headshot_kills INTEGER NOT NULL,
        won BOOLEAN NOT NULL,
        elo_before INTEGER,
        elo_after INTEGER,
        PRIMARY KEY (match_id, steam_id)
      );
      CREATE INDEX IF NOT EXISTS match_player_stats_steam_idx ON match_player_stats (steam_id);
      ALTER TABLE match_results ADD COLUMN IF NOT EXISTS worst_steam_id TEXT;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS utility_damage INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS enemies_flashed INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS friendlies_flashed INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS flash_assists INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS team_kills INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS suicides INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS knife_kills INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS rounds_played INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS bomb_plants INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS bomb_defuses INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS kills1 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS kills2 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS kills3 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS kills4 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS kills5 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS one_v1 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS one_v2 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS one_v3 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS one_v4 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS one_v5 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS first_kills INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS first_deaths INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS trade_kills INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS kast INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_player_stats ADD COLUMN IF NOT EXISTS mvps INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS server_players (
        steam_id TEXT PRIMARY KEY CHECK (steam_id ~ '^[0-9]{17}$'),
        display_name TEXT NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  async listMatches(): Promise<MatchRecord[]> {
    const r = await this.pool.query<Row>(`SELECT * FROM matches ORDER BY created_at DESC LIMIT 100`);
    return r.rows.map(toMatch);
  }

  async createMatch(input: CreateMatchInput): Promise<MatchRecord> {
    const r = await this.pool.query<Row>(
      `INSERT INTO matches (id, name, map_name, team_a_name, team_b_name, max_rounds, format, map_pool, knife_round,
         preset, overtime, overtime_rounds, playout, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [randomUUID(), input.name, input.mapName, input.teamAName, input.teamBName, input.maxRounds,
       input.format ?? "bo1", input.mapPool ?? [], input.knifeRound ?? true,
       input.preset ?? "custom", input.overtime ?? true, input.overtimeRounds ?? 6, input.playout ?? false, input.createdBy ?? null],
    );
    return toMatch(r.rows[0]!);
  }

  async getMatchByNumber(matchNumber: number): Promise<MatchRecord | null> {
    const r = await this.pool.query<Row>(`SELECT * FROM matches WHERE match_number = $1`, [matchNumber]);
    return r.rows[0] ? toMatch(r.rows[0]) : null;
  }

  async deleteMatch(matchId: string): Promise<void> {
    await this.pool.query(`DELETE FROM matches WHERE id = $1`, [matchId]);
  }

  async findActiveServerMatch(): Promise<MatchRecord | null> {
    const r = await this.pool.query<Row>(
      `SELECT * FROM matches WHERE server_state IN ('loading', 'warmup', 'live', 'paused', 'map_end') ORDER BY updated_at DESC LIMIT 1`,
    );
    return r.rows[0] ? toMatch(r.rows[0]) : null;
  }

  async setServerState(matchId: string, state: ServerState, error: string | null = null): Promise<void> {
    await this.pool.query(
      `UPDATE matches SET server_state = $2, server_error = $3, updated_at = now() WHERE id = $1`,
      [matchId, state, error],
    );
  }

  async setLive(matchId: string, live: LiveState): Promise<void> {
    await this.pool.query(`UPDATE matches SET live = $2::jsonb, updated_at = now() WHERE id = $1`, [matchId, JSON.stringify(live)]);
  }

  async getMatchById(matchId: string): Promise<MatchRecord | null> {
    const r = await this.pool.query<Row>(`SELECT * FROM matches WHERE id = $1`, [matchId]);
    return r.rows[0] ? toMatch(r.rows[0]) : null;
  }

  async setMatchPhase(matchId: string, phase: MatchPhase): Promise<void> {
    await this.pool.query(`UPDATE matches SET phase = $2, updated_at = now() WHERE id = $1`, [matchId, phase]);
  }

  async setMatchCaptains(matchId: string, captainAId: string | null, captainBId: string | null): Promise<void> {
    await this.pool.query(`UPDATE matches SET captain_a_id = $2, captain_b_id = $3, updated_at = now() WHERE id = $1`, [matchId, captainAId, captainBId]);
  }

  async setMatchSide(matchId: string, side: "a" | "b"): Promise<void> {
    await this.pool.query(`UPDATE matches SET side_choice = $2, updated_at = now() WHERE id = $1`, [matchId, side]);
  }

  async insertVeto(veto: Omit<VetoRecord, "id" | "createdAt">): Promise<void> {
    await this.pool.query(
      `INSERT INTO match_vetoes (id, match_id, seq, action, map_name, team, actor_steam_id, actor_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), veto.matchId, veto.seq, veto.action, veto.mapName, veto.team, veto.actorSteamId, veto.actorName],
    );
  }

  async listVetoes(matchId: string): Promise<VetoRecord[]> {
    const r = await this.pool.query<Row>(`SELECT * FROM match_vetoes WHERE match_id = $1 ORDER BY seq`, [matchId]);
    return r.rows.map(toVeto);
  }

  async findUserBySteamId(steamId: string): Promise<UserRecord | null> {
    const r = await this.pool.query<Row>(`SELECT * FROM users WHERE steam_id = $1`, [steamId]);
    return r.rows[0] ? toUser(r.rows[0]) : null;
  }

  async listUsers(): Promise<UserRecord[]> {
    const r = await this.pool.query<Row>(`SELECT * FROM users ORDER BY created_at LIMIT 500`);
    return r.rows.map(toUser);
  }

  async setUserRole(steamId: string, role: UserRole): Promise<void> {
    await this.pool.query(`UPDATE users SET role = $2 WHERE steam_id = $1`, [steamId, role]);
  }

  async promoteSuperAdmins(steamIds: string[]): Promise<void> {
    if (steamIds.length === 0) return;
    await this.pool.query(`UPDATE users SET role = 'superadmin' WHERE steam_id = ANY($1::text[])`, [steamIds]);
  }

  async updateUserProfile(steamId: string, displayName: string, avatarUrl: string | null): Promise<void> {
    await this.pool.query(
      `UPDATE users SET display_name = $2, avatar_url = $3, last_seen_at = now() WHERE steam_id = $1`,
      [steamId, displayName, avatarUrl],
    );
  }

  async upsertSteamUser(steamId: string): Promise<UserRecord> {
    const r = await this.pool.query<Row>(
      `INSERT INTO users (id, steam_id, display_name) VALUES ($1,$2,$3)
       ON CONFLICT (steam_id) DO UPDATE SET last_seen_at = now() RETURNING *`,
      [randomUUID(), steamId, `Jogador ${steamId.slice(-4)}`],
    );
    return toUser(r.rows[0]!);
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (id, token_hash, user_id, expires_at) VALUES ($1,$2,$3,$4)`,
      [randomUUID(), tokenHash, userId, expiresAt],
    );
  }

  async findSessionUser(tokenHash: string): Promise<SessionUser | null> {
    const r = await this.pool.query<Row>(
      `SELECT s.id AS session_id, u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash],
    );
    const row = r.rows[0];
    return row ? { user: toUser(row), sessionId: row.session_id as string } : null;
  }

  async touchSession(sessionId: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [sessionId]);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
  }

  async listOnlineUsers(withinSeconds: number): Promise<PresenceEntry[]> {
    const r = await this.pool.query<Row>(
      `SELECT DISTINCT u.steam_id, u.display_name, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.expires_at > now() AND s.last_seen_at > now() - make_interval(secs => $1)
       ORDER BY s.last_seen_at DESC`,
      [withinSeconds],
    );
    return r.rows.map((row) => ({ steamId: row.steam_id, displayName: row.display_name, lastSeenAt: iso(row.last_seen_at) }));
  }

  async replaceServerPlayers(players: HeartbeatPlayer[]): Promise<void> {
    await this.pool.query(`DELETE FROM server_players WHERE NOT (steam_id = ANY($1::text[]))`, [players.map((p) => p.steamId)]);
    await this.reportServerPlayers(players);
  }

  async reportServerPlayers(players: HeartbeatPlayer[]): Promise<void> {
    await this.pool.query(`DELETE FROM server_players WHERE last_seen_at < now() - interval '90 seconds'`);
    for (const p of players) {
      await this.pool.query(
        `INSERT INTO server_players (steam_id, display_name, last_seen_at) VALUES ($1,$2,now())
         ON CONFLICT (steam_id) DO UPDATE SET display_name = EXCLUDED.display_name, last_seen_at = now()`,
        [p.steamId, p.name],
      );
    }
  }

  async listServerPlayers(withinSeconds: number): Promise<PresenceEntry[]> {
    const r = await this.pool.query<Row>(
      `SELECT steam_id, display_name, last_seen_at FROM server_players
       WHERE last_seen_at > now() - make_interval(secs => $1) ORDER BY display_name`,
      [withinSeconds],
    );
    return r.rows.map((row) => ({ steamId: row.steam_id, displayName: row.display_name, lastSeenAt: iso(row.last_seen_at) }));
  }

  async joinMatch(matchId: string, userId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO match_players (match_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [matchId, userId],
    );
  }

  async setPlayerTeam(matchId: string, userId: string, team: "a" | "b"): Promise<void> {
    await this.pool.query(
      `UPDATE match_players SET team = $3 WHERE match_id = $1 AND user_id = $2`,
      [matchId, userId, team],
    );
  }

  async listMatchPlayers(matchId: string): Promise<MatchPlayerRecord[]> {
    const r = await this.pool.query<Row>(
      `SELECT u.id AS user_id, u.steam_id, u.display_name, u.avatar_url, mp.team, mp.joined_at
       FROM match_players mp JOIN users u ON u.id = mp.user_id WHERE mp.match_id = $1 ORDER BY mp.joined_at`,
      [matchId],
    );
    return r.rows.map((row) => ({
      userId: row.user_id, steamId: row.steam_id, displayName: row.display_name,
      avatarUrl: row.avatar_url ?? null, team: row.team, joinedAt: iso(row.joined_at),
    }));
  }

  async createInvite(matchId: string, inviterId: string, inviteeSteamId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO match_invites (id, match_id, inviter_id, invitee_id)
       SELECT $1, $2, $3, u.id FROM users u WHERE u.steam_id = $4
       ON CONFLICT (match_id, invitee_id) DO NOTHING`,
      [randomUUID(), matchId, inviterId, inviteeSteamId],
    );
  }

  async listInvitesForUser(userId: string): Promise<InviteRecord[]> {
    const r = await this.pool.query<Row>(
      `SELECT i.id, i.match_id, m.name AS match_name, inv.display_name AS inviter_name, i.status, i.created_at
       FROM match_invites i
       JOIN matches m ON m.id = i.match_id
       JOIN users inv ON inv.id = i.inviter_id
       WHERE i.invitee_id = $1 AND i.status = 'pending' ORDER BY i.created_at DESC`,
      [userId],
    );
    return r.rows.map((row) => ({
      id: row.id, matchId: row.match_id, matchName: row.match_name, inviterName: row.inviter_name,
      status: row.status, createdAt: iso(row.created_at),
    }));
  }

  async respondInvite(inviteId: string, userId: string, accept: boolean): Promise<void> {
    const r = await this.pool.query<Row>(
      `UPDATE match_invites SET status = $2 WHERE id = $1 AND invitee_id = $3 AND status = 'pending'
       RETURNING match_id`,
      [inviteId, accept ? "accepted" : "declined", userId],
    );
    const matchId = r.rows[0]?.match_id as string | undefined;
    if (accept && matchId) await this.joinMatch(matchId, userId);
  }

  async getEloBySteamIds(steamIds: string[]): Promise<Map<string, number>> {
    const r = await this.pool.query<Row>(`SELECT steam_id, elo FROM users WHERE steam_id = ANY($1::text[])`, [steamIds]);
    return new Map(r.rows.map((row) => [row.steam_id as string, Number(row.elo)]));
  }

  async recordMatchResult(result: MatchResultInput): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO match_results (match_id, winner, score_a, score_b, rounds, map_name, mvp_steam_id, worst_steam_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (match_id) DO NOTHING RETURNING match_id`,
        [result.matchId, result.winner, result.scoreA, result.scoreB, result.rounds, result.mapName, result.mvpSteamId, result.worstSteamId],
      );
      if (inserted.rowCount === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      for (const p of result.players) {
        await client.query(
          `INSERT INTO match_player_stats (match_id, steam_id, name, team, kills, deaths, assists, damage, headshot_kills, won, elo_before, elo_after,
             utility_damage, enemies_flashed, friendlies_flashed, flash_assists, team_kills, suicides, knife_kills, rounds_played,
             bomb_plants, bomb_defuses, kills1, kills2, kills3, kills4, kills5, one_v1, one_v2, one_v3, one_v4, one_v5,
             first_kills, first_deaths, trade_kills, kast, score, mvps)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38) ON CONFLICT DO NOTHING`,
          [result.matchId, p.steamId, p.name, p.team, p.kills, p.deaths, p.assists, p.damage, p.headshotKills, p.won, p.eloBefore, p.eloAfter,
            p.utilityDamage, p.enemiesFlashed, p.friendliesFlashed, p.flashAssists, p.teamKills, p.suicides, p.knifeKills, p.roundsPlayed,
            p.bombPlants, p.bombDefuses, p.kills1, p.kills2, p.kills3, p.kills4, p.kills5, p.oneV1, p.oneV2, p.oneV3, p.oneV4, p.oneV5,
            p.firstKills, p.firstDeaths, p.tradeKills, p.kast, p.score, p.mvps],
        );
        if (p.eloAfter !== null) await client.query(`UPDATE users SET elo = $2 WHERE steam_id = $1`, [p.steamId, p.eloAfter]);
      }
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private toStats = (row: Row): PlayerMatchStats => ({
    steamId: row.steam_id, name: row.name, team: row.team, kills: row.kills, deaths: row.deaths, assists: row.assists,
    damage: row.damage, headshotKills: row.headshot_kills, won: row.won, eloBefore: row.elo_before, eloAfter: row.elo_after,
    utilityDamage: row.utility_damage ?? 0, enemiesFlashed: row.enemies_flashed ?? 0, friendliesFlashed: row.friendlies_flashed ?? 0,
    flashAssists: row.flash_assists ?? 0, teamKills: row.team_kills ?? 0, suicides: row.suicides ?? 0, knifeKills: row.knife_kills ?? 0,
    roundsPlayed: row.rounds_played ?? 0, bombPlants: row.bomb_plants ?? 0, bombDefuses: row.bomb_defuses ?? 0,
    kills1: row.kills1 ?? 0, kills2: row.kills2 ?? 0, kills3: row.kills3 ?? 0, kills4: row.kills4 ?? 0, kills5: row.kills5 ?? 0,
    oneV1: row.one_v1 ?? 0, oneV2: row.one_v2 ?? 0, oneV3: row.one_v3 ?? 0, oneV4: row.one_v4 ?? 0, oneV5: row.one_v5 ?? 0,
    firstKills: row.first_kills ?? 0, firstDeaths: row.first_deaths ?? 0, tradeKills: row.trade_kills ?? 0,
    kast: row.kast ?? 0, score: row.score ?? 0, mvps: row.mvps ?? 0,
  });

  async getMatchResult(matchId: string): Promise<MatchResultRecord | null> {
    const r = await this.pool.query<Row>(`SELECT * FROM match_results WHERE match_id = $1`, [matchId]);
    const row = r.rows[0];
    if (!row) return null;
    const stats = await this.pool.query<Row>(`SELECT * FROM match_player_stats WHERE match_id = $1 ORDER BY kills DESC`, [matchId]);
    return {
      matchId, winner: row.winner, scoreA: row.score_a, scoreB: row.score_b, rounds: row.rounds, mapName: row.map_name,
      mvpSteamId: row.mvp_steam_id, worstSteamId: row.worst_steam_id ?? null, finishedAt: iso(row.finished_at), players: stats.rows.map(this.toStats),
    };
  }

  async listMatchHistory(limit: number, steamId?: string): Promise<MatchHistoryEntry[]> {
    const r = await this.pool.query<Row>(
      `SELECT r.*, m.name, m.team_a_name, m.team_b_name, m.format,
              (SELECT s.name FROM match_player_stats s WHERE s.match_id = r.match_id AND s.steam_id = r.mvp_steam_id) AS mvp_name,
              ps.team AS p_team, ps.kills AS p_kills, ps.deaths AS p_deaths, ps.assists AS p_assists, ps.won AS p_won,
              ps.elo_after - ps.elo_before AS p_delta
       FROM match_results r JOIN matches m ON m.id = r.match_id
       LEFT JOIN match_player_stats ps ON ps.match_id = r.match_id AND ps.steam_id = $2
       WHERE $2::text IS NULL OR ps.steam_id IS NOT NULL
       ORDER BY r.finished_at DESC LIMIT $1`,
      [limit, steamId ?? null],
    );
    return r.rows.map((row) => ({
      matchId: row.match_id, name: row.name, teamAName: row.team_a_name, teamBName: row.team_b_name, mapName: row.map_name,
      format: row.format, winner: row.winner, scoreA: row.score_a, scoreB: row.score_b, mvpName: row.mvp_name ?? null,
      finishedAt: iso(row.finished_at),
      ...(row.p_team ? { player: { team: row.p_team, kills: row.p_kills, deaths: row.p_deaths, assists: row.p_assists, won: row.p_won, eloDelta: row.p_delta ?? null } } : {}),
    }));
  }

  private toRanking = (row: Row): RankingEntry => ({
    steamId: row.steam_id, displayName: row.display_name, avatarUrl: row.avatar_url ?? null, elo: Number(row.elo),
    matches: Number(row.matches ?? 0), wins: Number(row.wins ?? 0), kills: Number(row.kills ?? 0), deaths: Number(row.deaths ?? 0),
    headshotKills: Number(row.headshot_kills ?? 0), damage: Number(row.damage ?? 0), rounds: Number(row.rounds ?? 0),
  });

  private static readonly RANKING_SELECT = `
    SELECT u.steam_id, u.display_name, u.avatar_url, u.elo,
           count(s.match_id) AS matches, count(*) FILTER (WHERE s.won) AS wins,
           coalesce(sum(s.kills), 0) AS kills, coalesce(sum(s.deaths), 0) AS deaths, coalesce(sum(s.assists), 0) AS assists,
           coalesce(sum(s.headshot_kills), 0) AS headshot_kills, coalesce(sum(s.damage), 0) AS damage,
           coalesce(sum(r.rounds), 0) AS rounds,
           count(*) FILTER (WHERE r.mvp_steam_id = u.steam_id) AS mvps
    FROM users u
    LEFT JOIN match_player_stats s ON s.steam_id = u.steam_id
    LEFT JOIN match_results r ON r.match_id = s.match_id`;

  async listRankings(limit: number): Promise<RankingEntry[]> {
    const r = await this.pool.query<Row>(
      `${PostgresDatabase.RANKING_SELECT} GROUP BY u.id HAVING count(s.match_id) > 0 ORDER BY u.elo DESC, wins DESC LIMIT $1`,
      [limit],
    );
    return r.rows.map(this.toRanking);
  }

  async getPlayerProfile(steamId: string): Promise<PlayerProfile | null> {
    const r = await this.pool.query<Row>(`${PostgresDatabase.RANKING_SELECT} WHERE u.steam_id = $1 GROUP BY u.id`, [steamId]);
    const row = r.rows[0];
    if (!row) return null;
    const [maps, history] = await Promise.all([
      this.pool.query<Row>(
        `SELECT r.map_name, count(*) AS matches, count(*) FILTER (WHERE s.won) AS wins
         FROM match_player_stats s JOIN match_results r ON r.match_id = s.match_id
         WHERE s.steam_id = $1 GROUP BY r.map_name ORDER BY matches DESC`,
        [steamId],
      ),
      this.pool.query<Row>(
        `SELECT r.finished_at, s.elo_after FROM match_player_stats s JOIN match_results r ON r.match_id = s.match_id
         WHERE s.steam_id = $1 AND s.elo_after IS NOT NULL ORDER BY r.finished_at DESC LIMIT 30`,
        [steamId],
      ),
    ]);
    return {
      ...this.toRanking(row), assists: Number(row.assists ?? 0), mvps: Number(row.mvps ?? 0),
      maps: maps.rows.map((m) => ({ mapName: m.map_name, matches: Number(m.matches), wins: Number(m.wins) })),
      eloHistory: history.rows.reverse().map((h) => ({ at: iso(h.finished_at), elo: Number(h.elo_after) })),
    };
  }

  async close(): Promise<void> { await this.pool.end(); }
}

export const hashSessionToken = (token: string) => createHash("sha256").update(token).digest("hex");
