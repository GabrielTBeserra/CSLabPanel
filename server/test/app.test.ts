import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/app.js";
import type { CreateMatchInput, MatchRecord, MatchStore } from "../src/database.js";

const match: MatchRecord = {
  id: "5ebf6bd8-eb48-45b7-bb7c-7e6f8b6f0f4e",
  name: "CS Home #1",
  mapName: "de_mirage",
  teamAName: "Alpha",
  teamBName: "Bravo",
  maxRounds: 24,
  format: "bo1",
  mapPool: [],
  phase: "lobby",
  captainAId: null,
  captainBId: null,
  sideChoice: null,
  status: "scheduled",
  createdBy: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const createDatabase = (created: CreateMatchInput[] = []): MatchStore => ({
  ping: async () => undefined,
  migrate: async () => undefined,
  listMatches: async () => [match],
  createMatch: async (input) => {
    created.push(input);
    return match;
  },
  upsertSteamUser: async (steamId) => ({
    id: "user-1",
    steamId,
    displayName: `Jogador ${steamId.slice(-4)}`,
    avatarUrl: null,
    role: "player",
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  }),
  updateUserProfile: async () => undefined,
  findUserBySteamId: async () => null,
  getMatchById: async () => match,
  setMatchPhase: async () => undefined,
  setMatchCaptains: async () => undefined,
  setMatchSide: async () => undefined,
  insertVeto: async () => undefined,
  listVetoes: async () => [],
  createSession: async () => undefined,
  findSessionUser: async () => null,
  touchSession: async () => undefined,
  deleteSession: async () => undefined,
  listOnlineUsers: async () => [],
  reportServerPlayers: async () => undefined,
  listServerPlayers: async () => [],
  joinMatch: async () => undefined,
  listMatchPlayers: async () => [],
  createInvite: async () => undefined,
  listInvitesForUser: async () => [],
  respondInvite: async () => undefined,
});

const config = {
  pluginToken: "test-plugin-token",
  adminToken: "test-admin-token",
  webOrigin: "http://localhost:5173",
};

describe("API foundation", () => {
  let app: FastifyInstance;
  let created: CreateMatchInput[];

  before(async () => {
    created = [];
    app = buildServer({ ...config, database: createDatabase(created) });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it("reports API health without exposing configuration", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: "ok",
      service: "cshome-api",
      timestamp: response.json().timestamp,
    });
    assert.equal(response.json().pluginToken, undefined);
    assert.equal(response.json().adminToken, undefined);
  });

  it("reports readiness only when the database probe succeeds", async () => {
    const readyApp = buildServer({ ...config, database: createDatabase() });
    const response = await readyApp.inject({ method: "GET", url: "/api/ready" });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().database, "connected");
    await readyApp.close();
  });

  it("returns a generic readiness error when the database probe fails", async () => {
    const database = createDatabase();
    database.ping = async () => {
      throw new Error("connection details must stay private");
    };
    const readyApp = buildServer({ ...config, database });
    const response = await readyApp.inject({ method: "GET", url: "/api/ready" });

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.includes("connection details must stay private"), false);
    await readyApp.close();
  });

  it("rejects admin requests without a valid bearer token", async () => {
    const response = await app.inject({ method: "GET", url: "/api/admin/matches" });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
  });

  it("lists matches for authenticated admins", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/matches",
      headers: { authorization: "Bearer test-admin-token" },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().matches, [match]);
  });

  it("creates a match for authenticated admins", async () => {
    const payload = {
      name: "CS Home #2",
      mapName: "de_nuke",
      teamAName: "Alpha",
      teamBName: "Bravo",
      maxRounds: 24,
    };
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/matches",
      headers: { authorization: "Bearer test-admin-token" },
      payload,
    });

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json().match, match);
    assert.deepEqual(created[0], payload);
  });

  it("rejects malformed match payloads with a normalized error", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/matches",
      headers: { authorization: "Bearer test-admin-token" },
      payload: { name: "", maxRounds: 99 },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: { code: "VALIDATION_ERROR", message: "Invalid request" },
    });
  });

  it("rejects plugin heartbeats without a valid bearer token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/plugin/heartbeat",
      payload: { pluginVersion: "0.1.0", sentAt: new Date().toISOString() },
    });

    assert.equal(response.statusCode, 401);
  });

  it("accepts a valid authenticated plugin heartbeat", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/plugin/heartbeat",
      headers: { authorization: "Bearer test-plugin-token" },
      payload: { pluginVersion: "0.1.0", sentAt: new Date().toISOString() },
    });

    assert.equal(response.statusCode, 202);
    assert.equal(response.json().accepted, true);
  });
});
