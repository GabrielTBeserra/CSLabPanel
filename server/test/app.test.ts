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
  preset: "official",
  overtime: true,
  overtimeRounds: 6,
  playout: false,
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
  replaceServerPlayers: async () => undefined,
  listServerPlayers: async () => [],
  joinMatch: async () => undefined,
  setPlayerTeam: async () => undefined,
  listMatchPlayers: async () => [],
  createInvite: async () => undefined,
  listInvitesForUser: async () => [],
  respondInvite: async () => undefined,
  getEloBySteamIds: async () => new Map(),
  recordMatchResult: async () => true,
  getMatchResult: async () => null,
  listMatchHistory: async () => [],
  listRankings: async () => [],
  getPlayerProfile: async () => null,
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

  it("uses the tunnel hostname as Steam return origin only for trusted tunnel hosts", async () => {
    const returnTo = async (host: string) => {
      const response = await app.inject({ method: "GET", url: "/api/auth/steam", headers: { host } });
      return new URL(response.headers.location as string).searchParams.get("openid.return_to");
    };
    assert.equal(await returnTo("abc-def.trycloudflare.com"), "https://abc-def.trycloudflare.com/api/auth/steam/return");
    assert.equal(await returnTo("evil.example.com"), "http://localhost:5173/api/auth/steam/return");
    assert.equal(await returnTo("trycloudflare.com.evil.com"), "http://localhost:5173/api/auth/steam/return");
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

  it("streams realtime events over an authenticated WebSocket", async () => {
    const database = createDatabase();
    database.findSessionUser = async () => ({ user: sessionUser, sessionId: "s1" });
    const app = buildServer({ ...config, database });
    await app.ready();
    await assert.rejects(app.injectWS("/api/ws"));
    const socket = await app.injectWS("/api/ws", { headers: cookie });
    const messages: { type: string; matchId?: string }[] = [];
    const received = new Promise<void>((resolve) => {
      socket.on("message", (data) => {
        messages.push(JSON.parse(String(data)));
        if (messages.some((m) => m.type === "match")) resolve();
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await app.inject({ method: "POST", url: "/api/plugin/events", headers: { authorization: "Bearer test-plugin-token" }, payload: { event: "going_live", matchid: 7 } });
    await received;
    assert.deepEqual(messages.find((m) => m.type === "match"), { type: "match", matchId: match.id });
    socket.terminate();
    await app.close();
  });

  it("records results, MVP and ELO when MatchZy reports the series end", async () => {
    const database = createDatabase();
    const results: { winner: string | null; mvpSteamId: string | null; players: { steamId: string; eloAfter: number | null }[] }[] = [];
    database.getMatchByNumber = async () => ({
      ...match, serverState: "live",
      live: {
        scoreA: 13, scoreB: 7,
        players: [
          { steamId: "76561198000000001", name: "A", team: "a", kills: 20, deaths: 10, assists: 3, damage: 2000, headshotKills: 8 },
          { steamId: "76561198000000002", name: "B", team: "b", kills: 10, deaths: 20, assists: 1, damage: 1000, headshotKills: 2 },
        ],
      },
    });
    database.getEloBySteamIds = async () => new Map([["76561198000000001", 1000], ["76561198000000002", 1000]]);
    database.recordMatchResult = async (result) => { results.push(result); return true; };
    const app = buildServer({ ...config, database });
    const response = await app.inject({
      method: "POST", url: "/api/plugin/events", headers: { authorization: "Bearer test-plugin-token" },
      payload: { event: "series_end", matchid: 7, team1_series_score: 1, team2_series_score: 0, winner: { team: "team1" } },
    });
    assert.equal(response.statusCode, 202);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.winner, "a");
    assert.equal(results[0]!.mvpSteamId, "76561198000000001");
    assert.deepEqual(results[0]!.players.map((p) => p.eloAfter), [1016, 984]);
    await app.close();
  });

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

  it("restricts the dynamic mode to the super admin", async () => {
    const app = buildAs("admin");
    const payload = { teamA: ["76561198000000001"], teamB: ["76561198000000002"], maps: ["de_mirage"], format: "bo1", preset: "official" };
    assert.equal((await app.inject({ method: "POST", url: "/api/dynamic/start", headers: cookie, payload })).statusCode, 403);
    await app.close();
  });

  it("starts a dynamic match with fixed teams and maps and loads it on the server", async () => {
    const database = createDatabase();
    database.findSessionUser = async () => ({ user: userWithRole("superadmin"), sessionId: "s1" });
    const teams: [string, string][] = [];
    const picks: string[] = [];
    database.upsertSteamUser = async (steamId) => ({ ...userWithRole("player"), id: `user-${steamId}`, steamId, displayName: "Jogador 0001" });
    database.setPlayerTeam = async (_, userId, team) => { teams.push([userId, team]); };
    database.insertVeto = async (veto) => { picks.push(veto.mapName!); };
    const commands: string[] = [];
    const app = buildServer({
      ...config, database, rcon: { host: "h", port: 1, password: "p" }, pluginApiUrl: "http://api",
      sendRcon: async (_, command) => { commands.push(command); return ""; },
    });
    const base = { teamA: ["76561198000000001"], teamB: ["76561198000000002"], format: "bo1", preset: "official" };
    const wrongMaps = await app.inject({ method: "POST", url: "/api/dynamic/start", headers: cookie, payload: { ...base, maps: ["de_mirage", "de_nuke"] } });
    assert.equal(wrongMaps.statusCode, 400);
    const overlap = await app.inject({ method: "POST", url: "/api/dynamic/start", headers: cookie, payload: { ...base, teamB: base.teamA, maps: ["de_mirage"] } });
    assert.equal(overlap.statusCode, 400);
    const response = await app.inject({ method: "POST", url: "/api/dynamic/start", headers: cookie, payload: { ...base, maps: ["de_mirage"] } });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().loading, true);
    assert.deepEqual(teams, [["user-76561198000000001", "a"], ["user-76561198000000002", "b"]]);
    assert.deepEqual(picks, ["de_mirage"]);
    assert.match(commands.at(-1)!, /^matchzy_loadmatch_url /);
    await app.close();
  });

  it("lists players reported by the presence plugin even when status_json is empty", async () => {
    const database = createDatabase();
    database.findSessionUser = async () => ({ user: userWithRole("superadmin"), sessionId: "s1" });
    const app = buildServer({
      ...config, database, rcon: { host: "h", port: 1, password: "p" },
      sendRcon: async () => JSON.stringify({ server: { clients: [{ steamid64: "0", bot: false, name: "" }] } }),
    });
    await app.inject({
      method: "POST", url: "/api/plugin/heartbeat", headers: { authorization: "Bearer test-plugin-token" },
      payload: { pluginVersion: "1.0.0", sentAt: new Date().toISOString(), players: [{ steamId: "76561198142791297", name: "MANO URSO" }] },
    });
    const response = await app.inject({ method: "GET", url: "/api/dynamic/players", headers: cookie });
    assert.deepEqual(response.json().players.map((p: { name: string }) => p.name), ["MANO URSO"]);
    await app.close();
  });

  it("asks for confirmation before replacing a match running on the server", async () => {
    const database = createDatabase();
    database.findSessionUser = async () => ({ user: userWithRole("superadmin"), sessionId: "s1" });
    database.findActiveServerMatch = async () => ({ ...match, id: "other", serverState: "live" });
    const app = buildServer({ ...config, database });
    const response = await app.inject({
      method: "POST", url: "/api/dynamic/start", headers: cookie,
      payload: { teamA: ["76561198000000001"], teamB: ["76561198000000002"], maps: ["de_mirage"], format: "bo1", preset: "quick" },
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, "SERVER_BUSY");
    await app.close();
  });

  it("lets admins shuffle a room they did not create", async () => {
    const app = buildAs("admin");
    const response = await app.inject({ method: "POST", url: `/api/matches/${match.id}/shuffle`, headers: cookie });
    assert.equal(response.statusCode, 200);
    await app.close();
  });
});
