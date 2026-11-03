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
}

export interface CreateMatchInput {
  name: string;
  mapName: string;
  teamAName: string;
  teamBName: string;
  maxRounds: number;
  format?: MatchFormat;
  mapPool?: string[];
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

export interface UserRecord {
  id: string;
  steamId: string;
  displayName: string;
  avatarUrl: string | null;
  role: "player" | "admin";
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
  getMatchById(matchId: string): Promise<MatchRecord | null>;
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
  listServerPlayers(withinSeconds: number): Promise<PresenceEntry[]>;
  joinMatch(matchId: string, userId: string): Promise<void>;
  listMatchPlayers(matchId: string): Promise<MatchPlayerRecord[]>;
  createInvite(matchId: string, inviterId: string, inviteeSteamId: string): Promise<void>;
  listInvitesForUser(userId: string): Promise<InviteRecord[]>;
  respondInvite(inviteId: string, userId: string, accept: boolean): Promise<void>;
}

type Row = QueryResultRow;

const iso = (v: unknown) => new Date(v as string | Date).toISOString();

const toMatch = (r: Row): MatchRecord => ({
  id: r.id, name: r.name, mapName: r.map_name, teamAName: r.team_a_name, teamBName: r.team_b_name,
  maxRounds: r.max_rounds, format: r.format ?? "bo1", mapPool: r.map_pool ?? [], phase: r.phase ?? "lobby",
  captainAId: r.captain_a_id ?? null, captainBId: r.captain_b_id ?? null, sideChoice: r.side_choice ?? null,
  status: r.status, createdBy: r.created_by ?? null,
  createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
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
      `INSERT INTO matches (id, name, map_name, team_a_name, team_b_name, max_rounds, format, map_pool, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [randomUUID(), input.name, input.mapName, input.teamAName, input.teamBName, input.maxRounds,
       input.format ?? "bo1", input.mapPool ?? [], input.createdBy ?? null],
    );
    return toMatch(r.rows[0]!);
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

  async listMatchPlayers(matchId: string): Promise<MatchPlayerRecord[]> {
    const r = await this.pool.query<Row>(
      `SELECT u.id AS user_id, u.steam_id, u.display_name, mp.team, mp.joined_at
       FROM match_players mp JOIN users u ON u.id = mp.user_id WHERE mp.match_id = $1 ORDER BY mp.joined_at`,
      [matchId],
    );
    return r.rows.map((row) => ({
      userId: row.user_id, steamId: row.steam_id, displayName: row.display_name,
      team: row.team, joinedAt: iso(row.joined_at),
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

  async close(): Promise<void> { await this.pool.end(); }
}

export const hashSessionToken = (token: string) => createHash("sha256").update(token).digest("hex");
