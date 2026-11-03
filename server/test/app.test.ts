import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/app.js";
import type { CreateMatchInput, MatchRecord, MatchStore, UserRecord, UserRole } from "../src/database.js";

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
  matchNumber: 7,
  knifeRound: true,
  serverState: "idle",
  serverError: null,
  live: {},
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
  listUsers: async () => [],
  setUserRole: async () => undefined,
  promoteSuperAdmins: async () => undefined,
  getMatchById: async () => match,
  getMatchByNumber: async () => match,
  deleteMatch: async () => undefined,
  findActiveServerMatch: async () => null,
  setServerState: async () => undefined,
  setLive: async () => undefined,
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
  setPlayerTeam: async () => undefined,
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

describe("Match server integration", () => {
  const sessionUser: UserRecord = {
    id: "u1", steamId: "76561198000000001", displayName: "P1", avatarUrl: null, role: "player",
    createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
  };
  const cookie = { cookie: "cshome_session=token" };

  it("rejects MatchZy events without the plugin token", async () => {
    const app = buildServer({ ...config, database: createDatabase() });
    const response = await app.inject({ method: "POST", url: "/api/plugin/events", payload: { event: "going_live", matchid: 7 } });
    assert.equal(response.statusCode, 401);
    await app.close();
  });

  it("stores live state from an authenticated MatchZy event", async () => {
    const database = createDatabase();
    const states: string[] = [];
    database.setServerState = async (_, state) => { states.push(state); };
    const app = buildServer({ ...config, database });
    const response = await app.inject({
      method: "POST", url: "/api/plugin/events", headers: { authorization: "Bearer test-plugin-token" },
      payload: { event: "going_live", matchid: 7, map_number: 0 },
    });
    assert.equal(response.statusCode, 202);
    assert.deepEqual(states, ["live"]);
    await app.close();
  });

  it("locks teams once the match leaves the lobby", async () => {
    const database = createDatabase();
    database.findSessionUser = async () => ({ user: sessionUser, sessionId: "s1" });
    database.getMatchById = async () => ({ ...match, phase: "veto" });
    const app = buildServer({ ...config, database });
    const response = await app.inject({ method: "POST", url: `/api/matches/${match.id}/team`, headers: cookie, payload: { team: "b" } });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, "TEAMS_LOCKED");
    await app.close();
  });

  it("loads the match on the CS2 server over RCON when the veto ends", async () => {
    const database = createDatabase();
    database.findSessionUser = async () => ({ user: sessionUser, sessionId: "s1" });
    const vetoMatch = { ...match, phase: "veto" as const, format: "bo1" as const, knifeRound: true, captainAId: "u1", captainBId: "u2", mapPool: ["de_mirage", "de_inferno", "de_nuke"] };
    database.getMatchById = async () => vetoMatch;
    database.listVetoes = async () => [{ id: "1", matchId: match.id, seq: 1, action: "ban", mapName: "de_nuke", team: "a", actorSteamId: "1", actorName: "P1", createdAt: "" }];
    const commands: string[] = [];
    database.setMatchPhase = async (_, phase) => { vetoMatch.phase = phase as "veto"; };
    sessionUser.id = "u2";
    const app = buildServer({
      ...config, database, rcon: { host: "127.0.0.1", port: 27015, password: "x" }, pluginApiUrl: "http://api",
      sendRcon: async (_, command) => { commands.push(command); return ""; },
    });
    const response = await app.inject({ method: "POST", url: `/api/matches/${match.id}/veto`, headers: cookie, payload: { action: "ban", mapName: "de_inferno" } });
    sessionUser.id = "u1";
    assert.equal(response.statusCode, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(commands.length, 1);
    assert.match(commands[0]!, /^matchzy_loadmatch_url "http:\/\/api\/api\/plugin\/matches\/7\/config" "Authorization" "Bearer test-plugin-token"$/);
    await app.close();
  });
});

describe("Roles", () => {
  const userWithRole = (role: UserRole): UserRecord => ({
    id: `user-${role}`, steamId: "76561198000000001", displayName: role, avatarUrl: null, role,
    createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
  });
  const target = { ...userWithRole("player"), id: "target", steamId: "76561198000000002" };
  const buildAs = (role: UserRole, roleChanges: [string, UserRole][] = []) => {
    const database = createDatabase();
    database.findSessionUser = async () => ({ user: userWithRole(role), sessionId: "s1" });
    database.findUserBySteamId = async (steamId) => (steamId === target.steamId ? target : null);
    database.setUserRole = async (steamId, newRole) => { roleChanges.push([steamId, newRole]); };
    return buildServer({ ...config, database });
  };
  const cookie = { cookie: "cshome_session=token" };

  it("forbids players from listing users", async () => {
    const app = buildAs("player");
    const response = await app.inject({ method: "GET", url: "/api/staff/users", headers: cookie });
    assert.equal(response.statusCode, 403);
    await app.close();
  });

  it("allows admins to list users but not change roles", async () => {
    const app = buildAs("admin");
    assert.equal((await app.inject({ method: "GET", url: "/api/staff/users", headers: cookie })).statusCode, 200);
    const response = await app.inject({
      method: "POST", url: `/api/staff/users/${target.steamId}/role`, headers: cookie, payload: { role: "admin" },
    });
    assert.equal(response.statusCode, 403);
    await app.close();
  });

  it("lets the super admin promote a player to admin", async () => {
    const changes: [string, UserRole][] = [];
    const app = buildAs("superadmin", changes);
    const response = await app.inject({
      method: "POST", url: `/api/staff/users/${target.steamId}/role`, headers: cookie, payload: { role: "admin" },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(changes, [[target.steamId, "admin"]]);
    await app.close();
  });

  it("never allows granting superadmin through the API", async () => {
    const app = buildAs("superadmin");
    const response = await app.inject({
      method: "POST", url: `/api/staff/users/${target.steamId}/role`, headers: cookie, payload: { role: "superadmin" },
    });
    assert.equal(response.statusCode, 400);
    await app.close();
  });

  it("only lets the super admin delete rooms", async () => {
    const admin = buildAs("admin");
    assert.equal((await admin.inject({ method: "DELETE", url: `/api/matches/${match.id}`, headers: cookie })).statusCode, 403);
    await admin.close();
    const superAdmin = buildAs("superadmin");
    assert.equal((await superAdmin.inject({ method: "DELETE", url: `/api/matches/${match.id}`, headers: cookie })).statusCode, 200);
    await superAdmin.close();
  });

  it("lets admins shuffle a room they did not create", async () => {
    const app = buildAs("admin");
    const response = await app.inject({ method: "POST", url: `/api/matches/${match.id}/shuffle`, headers: cookie });
    assert.equal(response.statusCode, 200);
    await app.close();
  });
});
