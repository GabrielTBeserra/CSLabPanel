import { randomUUID } from "node:crypto";
import { Pool, type PoolConfig, type QueryResultRow } from "pg";

export interface DatabaseHealthProbe {
  ping(): Promise<void>;
}

export interface MatchRecord {
  id: string;
  name: string;
  mapName: string;
  teamAName: string;
  teamBName: string;
  maxRounds: number;
  status: "scheduled" | "live" | "finished" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export interface CreateMatchInput {
  name: string;
  mapName: string;
  teamAName: string;
  teamBName: string;
  maxRounds: number;
}

export interface MatchStore {
  ping(): Promise<void>;
  migrate(): Promise<void>;
  listMatches(): Promise<MatchRecord[]>;
  createMatch(input: CreateMatchInput): Promise<MatchRecord>;
}

interface MatchRow extends QueryResultRow {
  id: string;
  name: string;
  map_name: string;
  team_a_name: string;
  team_b_name: string;
  max_rounds: number;
  status: MatchRecord["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

const toMatchRecord = (row: MatchRow): MatchRecord => ({
  id: row.id,
  name: row.name,
  mapName: row.map_name,
  teamAName: row.team_a_name,
  teamBName: row.team_b_name,
  maxRounds: row.max_rounds,
  status: row.status,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export class PostgresDatabase implements MatchStore {
  private readonly pool: Pool;

  constructor(configuration: PoolConfig) {
    this.pool = new Pool({
      ...configuration,
      max: 5,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 30000,
    });

    this.pool.on("error", (error) => {
      console.error(`[database] idle client error (${error.name})`);
    });
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
        map_name TEXT NOT NULL CHECK (char_length(map_name) BETWEEN 1 AND 40),
        team_a_name TEXT NOT NULL CHECK (char_length(team_a_name) BETWEEN 1 AND 64),
        team_b_name TEXT NOT NULL CHECK (char_length(team_b_name) BETWEEN 1 AND 64),
        max_rounds INTEGER NOT NULL CHECK (max_rounds BETWEEN 1 AND 30),
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'finished', 'cancelled')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  async listMatches(): Promise<MatchRecord[]> {
    const result = await this.pool.query<MatchRow>(`
      SELECT id, name, map_name, team_a_name, team_b_name, max_rounds, status, created_at, updated_at
      FROM matches
      ORDER BY created_at DESC
      LIMIT 100
    `);
    return result.rows.map(toMatchRecord);
  }

  async createMatch(input: CreateMatchInput): Promise<MatchRecord> {
    const result = await this.pool.query<MatchRow>(
      `
        INSERT INTO matches (id, name, map_name, team_a_name, team_b_name, max_rounds)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, name, map_name, team_a_name, team_b_name, max_rounds, status, created_at, updated_at
      `,
      [randomUUID(), input.name, input.mapName, input.teamAName, input.teamBName, input.maxRounds],
    );
    return toMatchRecord(result.rows[0]!);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
